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
import { loadVaultRegistry, TOOL_SUFFIXES } from './vault-registry.js';
import { requireToken, wsAuthOk } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// max anzahl gepufferter ws-nachrichten pro verbindung bevor wir droppen.
const MAX_QUEUE = 20;

async function loadBridge(bridgeMode, vaultRegistry) {
  if (bridgeMode === 'codex') {
    const { CodexBridge } = await import('./codex-bridge.js');
    console.log(`[server] bridge: codex (OpenAI Codex SDK)`);
    return new CodexBridge(vaultRegistry);
  }
  const { ClaudeBridge } = await import('./claude-bridge.js');
  console.log(`[server] bridge: claude (Claude Agent SDK)`);
  return new ClaudeBridge(vaultRegistry);
}

export async function createServer(opts = {}) {
  // env vars erst zur laufzeit lesen, damit tests VAULTS_ROOT ueberschreiben koennen
  const bridgeMode = process.env.BRIDGE || 'claude';
  const vaultsRoot = process.env.VAULTS_ROOT || join(__dirname, '..', 'vaults');

  if (process.env.VAULT_PATH && !process.env.VAULTS_ROOT) {
    console.warn('[server] VAULT_PATH is deprecated — use VAULTS_ROOT (pointing to the parent dir containing vault folders).');
  }

  const config = {
    port: opts.port ?? parseInt(process.env.PORT || '3000', 10),
    maxSessions: parseInt(process.env.MAX_SESSIONS || '50', 10),
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || '10', 10),
    maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '2000', 10),
  };

  const vaultRegistry = loadVaultRegistry(vaultsRoot);
  if (vaultRegistry.length === 0) {
    console.warn(`[server] WARNING: no vaults found under ${vaultsRoot} — LLM will have no tools.`);
  } else {
    console.log(`[server] loaded ${vaultRegistry.length} vault(s): ${vaultRegistry.map(v => v.toolPrefix).join(', ')}`);
    if (vaultRegistry.length > 20) {
      console.warn(`[server] WARNING: ${vaultRegistry.length} vaults = ${vaultRegistry.length * TOOL_SUFFIXES.length} tools — some agents may hit tool-count limits.`);
    }
  }

  // opts.bridge erlaubt tests einen kontrollierbaren fake-bridge zu injizieren.
  const bridge = opts.bridge ?? await loadBridge(bridgeMode, vaultRegistry);
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
      "default-src 'self'; script-src 'self' cdnjs.cloudflare.com 'unsafe-inline'; style-src 'self' cdnjs.cloudflare.com fonts.googleapis.com 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self' cdnjs.cloudflare.com fonts.gstatic.com data:"
    );
    next();
  });

  // opt-in token-auth vor allen API/MCP-routes. ohne API_TOKEN ein no-op.
  // /api/health bleibt immer offen, sonst kann der docker HEALTHCHECK (schickt
  // kein token) den container nie als healthy melden wenn API_TOKEN gesetzt ist.
  app.use(['/api', '/sse', '/messages', '/mcp'], (req, res, next) => {
    if ((req.originalUrl || '').split('?')[0] === '/api/health') return next();
    return requireToken(req, res, next);
  });

  app.use(createApiRouter(vaultRegistry));

  app.get('/sse', async (req, res) => {
    try {
      await handleSseGet(req, res, vaultRegistry);
    } catch (err) {
      console.error(`[server] /sse error: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/messages', async (req, res) => {
    try {
      await handleSsePost(req, res);
    } catch (err) {
      console.error(`[server] /messages error: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/mcp', async (req, res) => {
    try {
      await handleStreamablePost(req, res, vaultRegistry);
    } catch (err) {
      console.error(`[server] /mcp error: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
  });
  app.get('/mcp', (req, res) => { res.writeHead(405).end(); });
  app.delete('/mcp', (req, res) => { res.writeHead(405).end(); });

  app.use(express.static(join(__dirname, '..', 'public')));

  const server = createHttpServer(app);

  const wss = new WebSocketServer({
    server,
    maxPayload: 16 * 1024,
    verifyClient: ({ req }) => {
      // opt-in token-auth. ohne API_TOKEN ein no-op (default offen).
      if (!wsAuthOk(req)) return false;
      const origin = req.headers.origin;
      // ohne origin nur erlauben wenn explizit konfiguriert
      if (!origin) {
        if (process.env.ALLOW_NO_ORIGIN) return true;
        console.warn('[server] ws rejected: kein Origin-Header (ALLOW_NO_ORIGIN nicht gesetzt)');
        return false;
      }
      // same-origin immer erlauben: das mitgelieferte frontend verbindet zu
      // location.host, der browser schickt dann Origin-host == Host-header —
      // egal ob ip, hostname oder gemappter port. cross-site-hijacking bleibt
      // geblockt (fremde seite => fremder Origin-host).
      try {
        if (new URL(origin).host === req.headers.host) return true;
      } catch {
        console.warn(`[server] ws rejected: unparsebarer Origin "${origin}"`);
        return false;
      }
      const allowed = [
        'http://localhost:' + config.port,
        'https://localhost:' + config.port,
        'http://127.0.0.1:' + config.port,
      ];
      if (process.env.ALLOWED_ORIGINS) {
        allowed.push(...process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean));
      }
      if (allowed.includes(origin)) return true;
      console.warn(`[server] ws rejected: Origin "${origin}" passt nicht zu Host "${req.headers.host}" und steht nicht in ALLOWED_ORIGINS`);
      return false;
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
    ws.messageSent = false;
    // in-flight warm-up guard: hoechstens ein warm-up pro verbindung gleichzeitig.
    ws.warmUp = null;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.send(JSON.stringify({ type: 'session_init' }));
    ws.send(JSON.stringify({
      type: 'vaults',
      list: vaultRegistry.map(v => ({
        toolPrefix: v.toolPrefix,
        name: v.name,
        description: v.description,
      })),
    }));

    // Auto warm-up nur bei genau 1 Vault. Bei 2+ Vaults wartet der Server
    // auf select_vault vom Client (der default bereits mitschickt).
    if (vaultRegistry.length === 1) {
      warmUpSession(ws, manager, clientId, vaultRegistry[0].toolPrefix);
    } else if (vaultRegistry.length === 0) {
      // kein vault = nichts zu tun, aber frontend braucht den session_ready trotzdem nicht
      // (input bleibt disabled, da list leer)
    }

    ws.on('message', (data) => {
      // queue cappen, sonst kann ein client unbegrenzt nachrichten anstauen.
      if (ws.messageQueue.length >= MAX_QUEUE) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: 'Zu viele Nachrichten auf einmal. Warte kurz.' }));
        }
        return;
      }
      ws.messageQueue.push(data);
      processQueue(ws, manager, req, vaultRegistry);
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

// startet genau einen warm-up und merkt ihn als in-flight auf der verbindung.
// gibt das promise zurueck, damit aufrufer darauf warten koennen.
function warmUpSession(ws, manager, clientId, toolPrefix) {
  const promise = manager.createAndWarmUp(clientId, toolPrefix).then(() => {
    // stale-check: wenn der user zwischenzeitlich einen anderen vault gewaehlt hat,
    // ist in der session-map bereits ein placeholder/session mit anderem toolPrefix.
    // in dem fall kein session_ready mehr senden (der neue warmup uebernimmt).
    const current = manager.getSessionRaw(clientId);
    if (!current || current.toolPrefix !== toolPrefix) return;
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'session_ready', toolPrefix }));
  }).catch((err) => {
    // superseded ist erwartetes verhalten beim vault-wechsel, kein fehler fuer den user.
    if (err.message === 'Session superseded') return;
    console.error(`[server] warm-up failed for ${clientId}: ${err.message}`);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message: 'Da ist leider etwas schiefgelaufen. Lade die Seite einfach neu.' }));
    }
  }).finally(() => {
    // nur loeschen wenn es noch unser eintrag ist (kein neuerer warm-up gestartet).
    if (ws.warmUp && ws.warmUp.promise === promise) ws.warmUp = null;
  });
  ws.warmUp = { toolPrefix, promise };
  return promise;
}

async function processQueue(ws, manager, req, vaultRegistry) {
  if (ws.processing) return;
  ws.processing = true;
  try {
    while (ws.messageQueue.length > 0) {
      if (ws.readyState !== 1) {
        ws.messageQueue.length = 0;
        break;
      }
      const raw = ws.messageQueue.shift();
      await handleMessage(ws, manager, req, raw, vaultRegistry);
    }
  } finally {
    ws.processing = false;
  }
}

function getClientIp(req) {
  const peer = req.socket?.remoteAddress || 'unknown';
  // x-forwarded-for ist trivial faelschbar. nur auswerten wenn explizit ein
  // reverse proxy konfiguriert ist (TRUST_PROXY), sonst immer den socket-peer nehmen.
  if (!process.env.TRUST_PROXY) return peer;

  const xff = req.headers['x-forwarded-for'];
  if (!xff) return peer;
  const chain = xff.split(',').map(s => s.trim()).filter(Boolean);
  if (chain.length === 0) return peer;

  // bei TRUST_PROXY=<n> die n rechten (vertrauten) hops abstreifen, wie express'
  // trust-proxy-count. der naechste eintrag von rechts ist die echte client-ip.
  const hops = parseInt(process.env.TRUST_PROXY, 10);
  if (Number.isInteger(hops) && hops > 0) {
    const idx = chain.length - 1 - hops;
    return idx >= 0 ? chain[idx] : chain[0];
  }
  // sonst (loopback/true/subnetz-config): linkester eintrag als best effort.
  return chain[0];
}

async function handleMessage(ws, manager, req, raw, vaultRegistry) {
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

  if (msg.type === 'select_vault') {
    await handleSelectVault(ws, manager, msg, vaultRegistry, ip);
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
    ws.send(JSON.stringify({ type: 'error', message: 'Gleich gehts los, wird noch vorbereitet.' }));
    return;
  }

  // erst jetzt vault locken: nachricht hat validierung + rate-limit bestanden und
  // eine fertige session nimmt sie an. so sperrt eine abgelehnte erste nachricht
  // nicht dauerhaft den vault-selector.
  ws.messageSent = true;

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

async function handleSelectVault(ws, manager, msg, vaultRegistry, ip) {
  // rate-limit wie message/report, sonst kann ein client vault-wechsel spammen
  // und damit SDK-subprozesse fork-bomben.
  try {
    manager.checkRateLimit(ip);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  const toolPrefix = typeof msg.toolPrefix === 'string' ? msg.toolPrefix : '';
  const known = vaultRegistry.some(v => v.toolPrefix === toolPrefix);
  if (!known) {
    ws.send(JSON.stringify({ type: 'error', message: 'Unbekannter Vault.' }));
    return;
  }
  if (ws.messageSent) {
    // Vault ist nach erster Nachricht locked
    return;
  }

  // in-flight warm-up guard: laeuft bereits ein warm-up auf dieser verbindung...
  if (ws.warmUp) {
    // ...fuer denselben vault, dann ist das ein duplikat, einfach droppen.
    if (ws.warmUp.toolPrefix === toolPrefix) return;
    // ...fuer einen anderen vault, dann den laufenden erst abbrechen und abwarten,
    // bevor der neue startet. so ist hoechstens ein warm-up gleichzeitig aktiv.
    const previous = ws.warmUp.promise;
    try {
      await manager.removeSession(ws.clientId);
    } catch (err) {
      console.error(`[server] session switch cleanup error: ${err.message}`);
    }
    try { await previous; } catch {}
  }

  const existing = manager.getSessionRaw(ws.clientId);
  if (existing && existing.toolPrefix === toolPrefix) {
    // gleiche auswahl, no-op. session_ready wurde evtl. schon gesendet.
    if (existing.ready && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'session_ready', toolPrefix }));
    }
    return;
  }
  if (existing) {
    try {
      await manager.removeSession(ws.clientId);
    } catch (err) {
      console.error(`[server] session switch cleanup error: ${err.message}`);
    }
  }
  warmUpSession(ws, manager, ws.clientId, toolPrefix);
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
