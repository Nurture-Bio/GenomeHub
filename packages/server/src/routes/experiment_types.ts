import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { ExperimentType } from '../entities/index.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

router.get('/', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(ExperimentType);
  const types = await repo.find({ order: { name: 'ASC' } });
  res.json(types);
}));

router.post('/', asyncWrap(async (req, res) => {
  const { name, description, defaultTags } = req.body as {
    name: string; description?: string; defaultTags?: string[];
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const repo = AppDataSource.getRepository(ExperimentType);
  const et = repo.create({
    name,
    description: description ?? null,
    defaultTags: defaultTags ?? [],
  });
  await repo.save(et);
  res.status(201).json(et);
}));

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(ExperimentType);
  const et = await repo.findOneBy({ id: req.params.id });
  if (!et) { res.status(404).json({ error: 'not found' }); return; }

  const { name, description, defaultTags } = req.body as {
    name?: string; description?: string; defaultTags?: string[];
  };
  if (name !== undefined) et.name = name;
  if (description !== undefined) et.description = description;
  if (defaultTags !== undefined) et.defaultTags = defaultTags;
  await repo.save(et);
  res.json(et);
}));

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(ExperimentType);
  const et = await repo.findOneBy({ id: req.params.id });
  if (!et) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(et);
  res.json({ ok: true });
}));

export default router;
