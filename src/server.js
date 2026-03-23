import { createServer as createHttpServer } from 'node:http';
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
    sessionTimeoutMin: parseInt(process.env.SESSION_TIMEOUT_MIN || '30', 10),
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || '10', 10),
    maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '2000', 10),
  };

  const bridge = new CodexBridge();
  const manager = new SessionManager(bridge, config);

  const app = express();
  app.use(express.static(join(__dirname, '..', 'public')));

  const server = createHttpServer(app);

  const wss = new WebSocketServer({ server });

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

  // cleanup bei server-close
  server.on('close', () => {
    clearInterval(heartbeatInterval);
    wss.close();
    manager.shutdown();
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = url.searchParams.get('sid') || randomUUID();

    ws.isAlive = true;
    ws.clientId = clientId;
    ws.messageQueue = [];
    ws.processing = false;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // reconnect: ausstehende entfernung abbrechen
    manager.cancelRemoval(clientId);

    // ready-nachricht senden
    ws.send(JSON.stringify({ type: 'ready', sid: clientId }));

    ws.on('message', (data) => {
      ws.messageQueue.push(data);
      processQueue(ws, manager, req);
    });

    ws.on('close', () => {
      manager.scheduleRemoval(clientId);
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

  while (ws.messageQueue.length > 0) {
    const raw = ws.messageQueue.shift();
    await handleMessage(ws, manager, req, raw);
  }

  ws.processing = false;
}

async function handleMessage(ws, manager, req, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Ungültiges JSON' }));
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

  let session;
  try {
    session = await manager.getOrCreateSession(ws.clientId);
    manager.touchSession(ws.clientId);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  try {
    for await (const event of session.send(msg.content, msg.mode)) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(event));
      }
    }
  } catch (err) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }
}

// direkt starten wenn als main-modul ausgeführt
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  createServer().then(({ port }) => {
    console.log(`Server läuft auf http://localhost:${port}`);
  });
}
