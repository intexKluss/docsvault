import { createServer as createHttpServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { CodexBridge } from './codex-bridge.js';
import { SessionManager } from './session-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function createServer(opts = {}) {
  const config = {
    port: opts.port ?? parseInt(process.env.PORT || '3000', 10),
    maxSessions: parseInt(process.env.MAX_SESSIONS || '50', 10),
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || '10', 10),
    maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '2000', 10),
  };

  const bridge = new CodexBridge();
  const manager = new SessionManager(bridge, config);

  const app = express();
  app.use(express.static(join(__dirname, '..', 'public')));

  const server = createHttpServer(app);

  const wss = new WebSocketServer({
    server,
    maxPayload: 16 * 1024,
    verifyClient: ({ req }) => {
      const origin = req.headers.origin;
      if (!origin) return true; // non-browser clients
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

  // heartbeat: ping alle 30s, tote verbindungen beenden
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

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

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

    // sofort session_init senden
    ws.send(JSON.stringify({ type: 'session_init' }));

    // session im hintergrund erstellen und vorwaermen
    manager.createAndWarmUp(clientId).then(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'session_ready' }));
      }
    }).catch((err) => {
      console.error(`[server] warm-up failed for ${clientId}: ${err.message}`);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session konnte nicht erstellt werden. Bitte Seite neu laden.' }));
      }
    });

    ws.on('message', (data) => {
      ws.messageQueue.push(data);
      processQueue(ws, manager, req);
    });

    ws.on('close', () => {
      // session sofort beenden wenn user geht
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

// nachrichten-queue abarbeiten (eine nachricht gleichzeitig)
async function processQueue(ws, manager, req) {
  if (ws.processing) return;
  ws.processing = true;
  try {
    while (ws.messageQueue.length > 0) {
      const raw = ws.messageQueue.shift();
      await handleMessage(ws, manager, req, raw);
    }
  } finally {
    ws.processing = false;
  }
}

async function handleMessage(ws, manager, req, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Ungültiges JSON' }));
    return;
  }

  if (msg.type === 'report') {
    await handleReport(ws, msg, req);
    return;
  }

  if (msg.type !== 'message') return;

  const ip = req.socket.remoteAddress || 'unknown';

  try {
    manager.checkRateLimit(ip);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  try {
    manager.validateMessage(msg.content);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  const session = manager.getSession(ws.clientId);
  if (!session || !session.ready) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session wird noch eingerichtet. Bitte kurz warten.' }));
    return;
  }

  try {
    const mode = msg.mode === 'fast' ? 'fast' : 'thorough';
    for await (const event of session.send(msg.content, mode)) {
      // websocket geschlossen -> abbrechen
      if (ws.readyState !== 1) {
        console.log('[server] WebSocket closed, aborting query');
        break;
      }
      console.log(`[server] -> client: ${JSON.stringify(event).substring(0, 120)}`);
      ws.send(JSON.stringify(event));
    }
  } catch (err) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }
}

// bug reports
const REPORTS_PATH = join(__dirname, '..', 'reports.json');

async function handleReport(ws, msg, req) {
  const desc = typeof msg.description === 'string' ? msg.description.trim() : '';
  if (!desc || desc.length > 5000) {
    ws.send(JSON.stringify({ type: 'error', message: 'Ungültiger Bug-Report.' }));
    return;
  }

  const report = {
    timestamp: new Date().toISOString(),
    description: desc,
    chatContext: Array.isArray(msg.chatContext) ? msg.chatContext.slice(0, 10) : [],
    clientId: ws.clientId,
    ip: req.socket.remoteAddress || 'unknown',
  };

  try {
    let reports = [];
    try {
      const data = await readFile(REPORTS_PATH, 'utf8');
      reports = JSON.parse(data);
    } catch {
      // datei existiert noch nicht
    }
    reports.push(report);
    await writeFile(REPORTS_PATH, JSON.stringify(reports, null, 2));
    console.log(`[server] bug report saved (${reports.length} total)`);
    ws.send(JSON.stringify({ type: 'report_saved' }));
  } catch (err) {
    console.error(`[server] report save error: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: 'Report konnte nicht gespeichert werden.' }));
  }
}

// direkt starten wenn als main-modul ausgeführt
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  createServer().then(({ port }) => {
    console.log(`Server läuft auf http://localhost:${port}`);
  });
}
