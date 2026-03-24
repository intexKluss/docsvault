import { Router } from 'express';
import { handleSearch } from './tools/search.js';
import { handleRead } from './tools/read.js';
import { handleList } from './tools/list.js';
import { handleOverview } from './tools/overview.js';
import { handleStatus } from './tools/status.js';

export function createApiRouter(vaultPath) {
  const router = Router();

  router.get('/api/search', (req, res) => {
    const { query, section, max_results, context_lines } = req.query;
    if (!query) return res.status(400).json({ error: 'query parameter required' });
    const results = handleSearch(vaultPath, {
      query,
      section,
      max_results: max_results ? parseInt(max_results) : undefined,
      context_lines: context_lines ? parseInt(context_lines) : undefined,
    });
    res.json(results);
  });

  router.get('/api/read', (req, res) => {
    const { path, max_length } = req.query;
    if (!path) return res.status(400).json({ error: 'path parameter required' });
    const result = handleRead(vaultPath, {
      path,
      max_length: max_length ? parseInt(max_length) : undefined,
    });
    if (result.error) return res.status(404).json(result);
    res.json(result);
  });

  router.get('/api/list', (req, res) => {
    const { section, subfolder } = req.query;
    if (!section) return res.status(400).json({ error: 'section parameter required' });
    const files = handleList(vaultPath, { section, subfolder });
    res.json(files);
  });

  router.get('/api/overview', (req, res) => {
    const { section } = req.query;
    const result = handleOverview(vaultPath, { section });
    res.json({ text: result });
  });

  router.get('/api/status', (req, res) => {
    const result = handleStatus(vaultPath);
    res.json(result);
  });

  return router;
}
