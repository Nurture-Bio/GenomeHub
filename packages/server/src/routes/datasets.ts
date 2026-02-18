import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, Dataset, EntityEdge } from '../entities/index.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

// ─── List datasets ──────────────────────────────────────────

router.get('/', asyncWrap(async (req, res) => {
  const { experimentId, projectId, kind } = req.query as {
    experimentId?: string; projectId?: string; kind?: string;
  };

  const edgeRepo = AppDataSource.getRepository(EntityEdge);
  let filteredIds: string[] | null = null;

  if (experimentId) {
    const dsEdges = await edgeRepo.find({
      where: { sourceType: 'dataset' as any, targetType: 'experiment' as any, targetId: experimentId, relation: 'belongs_to' as any },
    });
    filteredIds = dsEdges.map(e => e.sourceId);
  }

  if (projectId) {
    const dsEdges = await edgeRepo.find({
      where: { sourceType: 'dataset' as any, targetType: 'project' as any, targetId: projectId, relation: 'belongs_to' as any },
    });
    const projDsIds = dsEdges.map(e => e.sourceId);
    filteredIds = filteredIds ? filteredIds.filter(id => projDsIds.includes(id)) : projDsIds;
  }

  const repo = AppDataSource.getRepository(Dataset);
  let qb = repo.createQueryBuilder('d').orderBy('d.created_at', 'ASC');

  if (filteredIds !== null) {
    if (!filteredIds.length) { res.json([]); return; }
    qb = qb.where('d.id IN (:...ids)', { ids: filteredIds });
  }
  if (kind) qb = qb.andWhere('d.kind = :kind', { kind });

  const datasets = await qb.getMany();
  if (!datasets.length) { res.json([]); return; }

  const dsIds = datasets.map(d => d.id);

  // Load experiment names via edges
  const expEdges = await edgeRepo.createQueryBuilder('e')
    .where("e.source_type = 'dataset' AND e.target_type = 'experiment' AND e.relation = 'belongs_to'")
    .andWhere('e.source_id IN (:...ids)', { ids: dsIds })
    .getMany();

  const expIdByDs = new Map<string, string>();
  for (const e of expEdges) expIdByDs.set(e.sourceId, e.targetId);

  const { Experiment } = await import('../entities/index.js');
  const allExpIds = [...new Set(expIdByDs.values())];
  const expMap = new Map<string, { id: string; name: string }>();
  if (allExpIds.length) {
    const exps = await AppDataSource.getRepository(Experiment).findByIds(allExpIds);
    exps.forEach(e => expMap.set(e.id, e));
  }

  // File counts
  const fileCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_id', 'targetId')
    .addSelect('COUNT(*)', 'fileCount')
    .where("e.source_type = 'file' AND e.target_type = 'dataset' AND e.relation = 'belongs_to'")
    .andWhere('e.target_id IN (:...ids)', { ids: dsIds })
    .groupBy('e.target_id')
    .getRawMany<{ targetId: string; fileCount: string }>();
  const fileMap = new Map(fileCounts.map(s => [s.targetId, parseInt(s.fileCount)]));

  res.json(datasets.map(d => {
    const eId = expIdByDs.get(d.id);
    const exp = eId ? expMap.get(eId) : null;
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      description: d.description,
      condition: d.condition,
      replicate: d.replicate,
      metadata: d.metadata,
      tags: d.tags,
      experimentId: eId ?? null,
      experimentName: exp?.name ?? null,
      fileCount: fileMap.get(d.id) ?? 0,
      createdAt: d.createdAt,
    };
  }));
}));

// ─── Create dataset ─────────────────────────────────────────

router.post('/', asyncWrap(async (req, res) => {
  const { name, kind, description, condition, replicate, metadata, tags, experimentId, projectId } = req.body as {
    name: string; kind?: string; description?: string;
    condition?: string; replicate?: number; metadata?: Record<string, unknown>;
    tags?: string[]; experimentId?: string; projectId?: string;
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const repo = AppDataSource.getRepository(Dataset);
  const userId = (res.locals.user as User)?.id ?? null;

  const dataset = repo.create({
    name,
    kind: (kind as any) ?? 'sample',
    description: description ?? null,
    condition: condition ?? null,
    replicate: replicate ?? null,
    metadata: metadata ?? null,
    tags: tags ?? [],
    createdBy: userId,
  });
  await repo.save(dataset);

  // Create edges
  if (experimentId) {
    await edges.link({ type: 'dataset', id: dataset.id }, { type: 'experiment', id: experimentId }, 'belongs_to', null, userId);
  }
  if (projectId) {
    await edges.link({ type: 'dataset', id: dataset.id }, { type: 'project', id: projectId }, 'belongs_to', null, userId);
  }

  res.status(201).json(dataset);
}));

// ─── Update dataset ─────────────────────────────────────────

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Dataset);
  const dataset = await repo.findOneBy({ id: req.params.id });
  if (!dataset) { res.status(404).json({ error: 'not found' }); return; }

  const { name, kind, description, condition, replicate, metadata, tags } = req.body as Partial<{
    name: string; kind: string; description: string; condition: string;
    replicate: number; metadata: Record<string, unknown>; tags: string[];
  }>;

  if (name !== undefined) dataset.name = name;
  if (kind !== undefined) dataset.kind = kind as any;
  if (description !== undefined) dataset.description = description || null;
  if (condition !== undefined) dataset.condition = condition || null;
  if (replicate !== undefined) dataset.replicate = replicate;
  if (metadata !== undefined) dataset.metadata = metadata;
  if (tags !== undefined) dataset.tags = tags;

  await repo.save(dataset);
  res.json(dataset);
}));

// ─── Delete dataset ─────────────────────────────────────────

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Dataset);
  const dataset = await repo.findOneBy({ id: req.params.id });
  if (!dataset) { res.status(404).json({ error: 'not found' }); return; }

  await edges.cascadeDelete({ type: 'dataset', id: dataset.id });
  await repo.remove(dataset);
  res.json({ ok: true });
}));

export default router;
