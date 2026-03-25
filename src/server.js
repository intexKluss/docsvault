import { createServer as createHttpServer } from 'node:http';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { SessionManager } from './session-manager.js';
import { handleSseGet, handleSsePost, handleStreamablePost } from './mcp-handler.js';
import { createApiRouter } from './api-routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_MODE = process.env.BRIDGE || 'claude';
const VAULT_PATH = process.env.VAULT_PATH || join(__dirname, '..', 'vault');

async function loadBridge() {
  if (BRIDGE_MODE === 'codex') {
    const { CodexBridge } = await import('./codex-bridge.js');
    console.log(`[server] bridge: codex (OpenAI Codex SDK)`);
    return new CodexBridge();
  }
  const { ClaudeBridge } = await import('./claude-bridge.js');
  console.log(`[server] bridge: claude (Claude Agent SDK)`);
  return new ClaudeBridge();
}

export async function createServer(opts = {}) {
  const config = {
    port: opts.port ?? parseInt(process.env.PORT || '3000', 10),
    maxSessions: parseInt(process.env.MAX_SESSIONS || '50', 10),
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || '10', 10),
    maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '2000', 10),
  };

  const bridge = await loadBridge();
  const manager = new SessionManager(bridge, config);

  const app = express();

  // trust proxy für korrekte IP hinter reverse proxy
  if (process.env.TRUST_PROXY) {
    const val = process.env.TRUST_PROXY;
    if (['loopback', '1', 'true'].includes(val)) {
      app.set('trust proxy', val === 'true' ? 'loopback' : val);
    } else {
      app.set('trust proxy', val);
    }
  }

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self' cdnjs.cloudflare.com; style-src 'self' cdnjs.cloudflare.com 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self' cdnjs.cloudflare.com"
    );
    next();
  });

  app.use(createApiRouter(VAULT_PATH));

  app.get('/sse', (req, res) => {
    handleSseGet(req, res, VAULT_PATH);
  });

  app.post('/messages', express.json(), (req, res) => {
    handleSsePost(req, res);
  });

  app.post('/mcp', async (req, res) => {
    await handleStreamablePost(req, res, VAULT_PATH);
  });
  app.get('/mcp', (req, res) => { res.writeHead(405).end(); });
  app.delete('/mcp', (req, res) => { res.writeHead(405).end(); });

  app.use(express.static(join(__dirname, '..', 'public')));

  const server = createHttpServer(app);

  const wss = new WebSocketServer({
    server,
    maxPayload: 16 * 1024,
    verifyClient: ({ req }) => {
      const origin = req.headers.origin;
      // ohne origin nur erlauben wenn explizit konfiguriert
      if (!origin) return !!process.env.ALLOW_NO_ORIGIN;
      const allowed = [
        'http://localhost:' + config.port,
        'https://localhost:' + config.port,
        'http://127.0.0.1:' + config.port,
      ];
      if (process.env.ALLOWED_ORIGINS) {
        allowed.push(...process.env.ALLOWED_ORIGINS.split(','));
      }
      return allowed.includes(origin);
    }
  });

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  // nur an einer stelle cleanen
  server.on('close', () => {
    clearInterval(heartbeatInterval);
    wss.close();
    manager.shutdown();
  });

  wss.on('connection', (ws, req) => {
    const clientId = randomUUID();

    ws.isAlive = true;
    ws.clientId = clientId;
    ws.messageQueue = [];
    ws.processing = false;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.send(JSON.stringify({ type: 'session_init' }));

    manager.createAndWarmUp(clientId).then(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'session_ready' }));
      }
    }).catch((err) => {
      console.error(`[server] warm-up failed for ${clientId}: ${err.message}`);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: 'Da ist leider etwas schiefgelaufen. Lade die Seite einfach neu.' }));
      }
    });

    ws.on('message', (data) => {
      ws.messageQueue.push(data);
      processQueue(ws, manager, req);
    });

    ws.on('close', () => {
      manager.removeSession(clientId).catch((err) => {
        console.error(`[server] session cleanup error: ${err.message}`);
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(config.port, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function processQueue(ws, manager, req) {
  if (ws.processing) return;
  ws.processing = true;
  try {
    while (ws.messageQueue.length > 0) {
      if (ws.readyState !== 1) {
        ws.messageQueue.length = 0;
        break;
      }
      const raw = ws.messageQueue.shift();
      await handleMessage(ws, manager, req, raw);
    }
  } finally {
    ws.processing = false;
  }
}

function getClientIp(req) {
  if (process.env.TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function handleMessage(ws, manager, req, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Ungültiges JSON' }));
    return;
  }

  const ip = getClientIp(req);

  if (msg.type === 'report') {
    try {
      manager.checkRateLimit(ip);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      return;
    }
    await handleReport(ws, msg);
    return;
  }

  if (msg.type !== 'message') return;

  try {
    manager.validateMessage(msg.content);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  try {
    manager.checkRateLimit(ip);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  const session = manager.getSession(ws.clientId);
  if (!session || !session.ready) {
    ws.send(JSON.stringify({ type: 'error', message: 'Gleich gehts los — wird noch vorbereitet.' }));
    return;
  }

  try {
    const mode = msg.mode === 'fast' ? 'fast' : 'thorough';
    for await (const event of session.send(msg.content, mode)) {
      if (ws.readyState !== 1) break;
      ws.send(JSON.stringify(event));
    }
  } catch (err) {
    console.error(`[server] query error: ${err.message}`);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message: 'Fehler bei der Verarbeitung. Bitte versuche es erneut.' }));
      ws.send(JSON.stringify({ type: 'done' }));
    }
  }
}

// append-only JSONL, no race conditions
const REPORTS_PATH = join(__dirname, '..', 'reports.json');
const MAX_CONTEXT_ITEM_LENGTH = 600;

function sanitizeChatContext(context) {
  if (!Array.isArray(context)) return [];
  return context.slice(0, 10).map((item) => {
    if (typeof item !== 'object' || item === null) return null;
    const role = typeof item.role === 'string' ? item.role.substring(0, 20) : 'unknown';
    const text = typeof item.text === 'string' ? item.text.substring(0, MAX_CONTEXT_ITEM_LENGTH) : '';
    return { role, text };
  }).filter(Boolean);
}

async function handleReport(ws, msg) {
  const desc = typeof msg.description === 'string' ? msg.description.trim() : '';
  if (!desc || desc.length > 5000) {
    ws.send(JSON.stringify({ type: 'error', message: 'Ungültiger Bug-Report.' }));
    return;
  }

  const report = {
    timestamp: new Date().toISOString(),
    description: desc,
    chatContext: sanitizeChatContext(msg.chatContext),
    clientId: ws.clientId,
  };

  try {
    await appendFile(REPORTS_PATH, JSON.stringify(report) + '\n');
    console.log(`[server] bug report saved`);
    ws.send(JSON.stringify({ type: 'report_saved' }));
  } catch (err) {
    console.error(`[server] report save error: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: 'Report konnte nicht gespeichert werden.' }));
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  createServer().then(({ server, port }) => {
    console.log(`Server läuft auf http://localhost:${port}`);

    function shutdown(signal) {
      console.log(`[server] ${signal} received, shutting down...`);
      server.close(() => {
        console.log('[server] closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('[server] forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
}
