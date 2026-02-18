import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { Technique } from '../entities/index.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

router.get('/', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(Technique);
  const techniques = await repo.find({ order: { name: 'ASC' } });
  res.json(techniques);
}));

router.post('/', asyncWrap(async (req, res) => {
  const { name, description, defaultTags } = req.body as {
    name: string; description?: string; defaultTags?: string[];
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const repo = AppDataSource.getRepository(Technique);
  const t = repo.create({
    name,
    description: description ?? null,
    defaultTags: defaultTags ?? [],
  });
  await repo.save(t);
  res.status(201).json(t);
}));

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Technique);
  const t = await repo.findOneBy({ id: req.params.id });
  if (!t) { res.status(404).json({ error: 'not found' }); return; }

  const { name, description, defaultTags } = req.body as {
    name?: string; description?: string; defaultTags?: string[];
  };
  if (name !== undefined) t.name = name;
  if (description !== undefined) t.description = description;
  if (defaultTags !== undefined) t.defaultTags = defaultTags;
  await repo.save(t);
  res.json(t);
}));

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Technique);
  const t = await repo.findOneBy({ id: req.params.id });
  if (!t) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(t);
  res.json({ ok: true });
}));

export default router;
