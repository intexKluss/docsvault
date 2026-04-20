import { Router } from 'express';
import { handleSearch } from './tools/search.js';
import { handleRead } from './tools/read.js';
import { handleList } from './tools/list.js';
import { handleOverview } from './tools/overview.js';
import { handleStatus } from './tools/status.js';

function clampInt(value, min, max, fallback) {
  if (value == null) return fallback;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const apiRateCounts = new Map();
const API_RATE_LIMIT = parseInt(process.env.API_RATE_LIMIT_PER_MIN || '60', 10);

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of apiRateCounts) {
    if (now > entry.resetAt) apiRateCounts.delete(ip);
  }
}, 60000);

function apiRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = apiRateCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60000 };
    apiRateCounts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > API_RATE_LIMIT) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }
  next();
}

function registerVaultRoutes(router, vault) {
  const base = `/api/${vault.toolPrefix}`;
  const vaultPath = vault.path;

  router.get(`${base}/search`, (req, res) => {
    const { query, section } = req.query;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query parameter required' });
    }
    const results = handleSearch(vaultPath, {
      query: query.trim(),
      section: section || undefined,
      max_results: clampInt(req.query.max_results, 1, 100, 10),
      context_lines: clampInt(req.query.context_lines, 0, 20, 3),
    });
    res.json(results);
  });

  router.get(`${base}/read`, (req, res) => {
    const { path: docPath } = req.query;
    if (!docPath || typeof docPath !== 'string' || !docPath.trim()) {
      return res.status(400).json({ error: 'path parameter required' });
    }
    const result = handleRead(vaultPath, {
      path: docPath.trim(),
      max_length: clampInt(req.query.max_length, 1, 200000, 50000),
    });
    if (result.error) return res.status(404).json(result);
    res.json(result);
  });

  router.get(`${base}/list`, (req, res) => {
    const { section, subfolder } = req.query;
    if (!section || typeof section !== 'string' || !section.trim()) {
      return res.status(400).json({ error: 'section parameter required' });
    }
    const files = handleList(vaultPath, {
      section: section.trim(),
      subfolder: subfolder || undefined,
    });
    res.json(files);
  });

  router.get(`${base}/overview`, (req, res) => {
    const { section } = req.query;
    const result = handleOverview(vaultPath, { section: section || undefined }, vault.name);
    res.json({ text: result });
  });

  router.get(`${base}/status`, (req, res) => {
    const result = handleStatus(vaultPath);
    res.json(result);
  });
}

export function createApiRouter(vaultRegistry) {
  const router = Router();

  router.use('/api', apiRateLimit);

  router.get('/api/health', (req, res) => {
    res.json({ status: 'ok', vaults: vaultRegistry.length });
  });

  router.get('/api/vaults', (req, res) => {
    res.json({
      vaults: vaultRegistry.map(v => ({
        toolPrefix: v.toolPrefix,
        name: v.name,
        description: v.description,
      })),
    });
  });

  for (const vault of vaultRegistry) {
    registerVaultRoutes(router, vault);
  }

  router.use('/api', (err, req, res, next) => {
    console.error(`[api] error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}
