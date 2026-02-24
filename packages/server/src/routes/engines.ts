import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import { Engine } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';

const router = Router();

// ── CRUD ──────────────────────────────────────────────────

router.get('/', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const engines = await repo.find({ order: { name: 'ASC' } });

  const results = await Promise.all(engines.map(async (engine) => {
    let status: 'ok' | 'error' | 'unavailable' = 'unavailable';
    try {
      const r = await fetch(`${engine.url}/api/health`, { signal: AbortSignal.timeout(3000) });
      const body = await r.json();
      status = body.status === 'ok' ? 'ok' : 'error';
    } catch { /* unavailable */ }
    return { id: engine.id, name: engine.name, url: engine.url, status, createdAt: engine.createdAt };
  }));

  res.json(results);
}));

router.post('/', asyncWrap(async (req, res) => {
  const { name, url } = req.body as { name?: string; url?: string };
  if (!name?.trim() || !url?.trim()) {
    res.status(400).json({ error: 'name and url required' });
    return;
  }
  const repo = AppDataSource.getRepository(Engine);
  const engine = repo.create({ name: name.trim(), url: url.trim() });
  await repo.save(engine);
  res.status(201).json(engine);
}));

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const engine = await repo.findOneBy({ id: req.params.id });
  if (!engine) { res.status(404).json({ error: 'not found' }); return; }
  const { name, url } = req.body as { name?: string; url?: string };
  if (name !== undefined) engine.name = name;
  if (url !== undefined) engine.url = url;
  await repo.save(engine);
  res.json(engine);
}));

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const engine = await repo.findOneBy({ id: req.params.id });
  if (!engine) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(engine);
  res.json({ ok: true });
}));

export default router;
