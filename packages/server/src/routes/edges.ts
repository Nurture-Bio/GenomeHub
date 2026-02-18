import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, EntityEdge, type EntityType, type EdgeRelation } from '../entities/index.js';
import { detectLinkService } from '../lib/link_service.js';
import * as edgeService from '../lib/edge_service.js';

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

// ─── Edge CRUD router (mounted at /api/edges) ──────────────

const router = Router();

router.get('/', asyncWrap(async (req, res) => {
  const { sourceType, sourceId, targetType, targetId, relation } = req.query as {
    sourceType?: string; sourceId?: string; targetType?: string; targetId?: string; relation?: string;
  };

  const repo = AppDataSource.getRepository(EntityEdge);
  const qb = repo.createQueryBuilder('e').orderBy('e.created_at', 'ASC');

  if (sourceType) qb.andWhere('e.source_type = :sourceType', { sourceType });
  if (sourceId) qb.andWhere('e.source_id = :sourceId', { sourceId });
  if (targetType) qb.andWhere('e.target_type = :targetType', { targetType });
  if (targetId) qb.andWhere('e.target_id = :targetId', { targetId });
  if (relation) qb.andWhere('e.relation = :relation', { relation });

  res.json(await qb.getMany());
}));

router.post('/', asyncWrap(async (req, res) => {
  const { sourceType, sourceId, targetType, targetId, relation, metadata } = req.body as {
    sourceType: string; sourceId: string; targetType: string; targetId: string;
    relation: string; metadata?: Record<string, unknown>;
  };

  if (!sourceType || !sourceId || !targetType || !targetId || !relation) {
    res.status(400).json({ error: 'sourceType, sourceId, targetType, targetId, and relation required' });
    return;
  }

  const userId = (res.locals.user as User)?.id ?? null;
  const edge = await edgeService.link(
    { type: sourceType as EntityType, id: sourceId },
    { type: targetType as EntityType, id: targetId },
    relation as EdgeRelation,
    metadata ?? null,
    userId,
  );
  res.status(201).json(edge);
}));

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(EntityEdge);
  const edge = await repo.findOneBy({ id: req.params.id });
  if (!edge) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(edge);
  res.json({ ok: true });
}));

export default router;

// ─── Links router (backward-compatible, mounted at /api/links) ──

export const linksRouter = Router();

linksRouter.get('/', asyncWrap(async (req, res) => {
  const { parentType, parentId } = req.query as { parentType?: string; parentId?: string };

  const repo = AppDataSource.getRepository(EntityEdge);
  const qb = repo.createQueryBuilder('e')
    .where("e.relation = 'links_to'")
    .orderBy('e.created_at', 'ASC');

  if (parentType) qb.andWhere('e.source_type = :parentType', { parentType });
  if (parentId) qb.andWhere('e.source_id = :parentId', { parentId });

  const edges = await qb.getMany();
  res.json(edges.map(e => ({
    id: e.id,
    parentType: e.sourceType,
    parentId: e.sourceId,
    url: (e.metadata as any)?.url ?? '',
    service: (e.metadata as any)?.service ?? 'link',
    label: (e.metadata as any)?.label ?? null,
    createdAt: e.createdAt,
  })));
}));

linksRouter.post('/', asyncWrap(async (req, res) => {
  const { parentType, parentId, url, label } = req.body as {
    parentType: string; parentId: string; url: string; label?: string;
  };
  if (!parentType || !parentId || !url) {
    res.status(400).json({ error: 'parentType, parentId, and url required' }); return;
  }

  const detected = detectLinkService(url);
  const userId = (res.locals.user as User)?.id ?? null;
  const edge = await edgeService.link(
    { type: parentType as EntityType, id: parentId },
    { type: parentType as EntityType, id: parentId },
    'links_to',
    {
      url,
      service: detected.service,
      label: label ?? detected.label ?? null,
    },
    userId,
  );

  res.status(201).json({
    id: edge.id,
    parentType: edge.sourceType,
    parentId: edge.sourceId,
    url,
    service: detected.service,
    label: label ?? detected.label ?? null,
    createdAt: edge.createdAt,
  });
}));

linksRouter.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(EntityEdge);
  const edge = await repo.findOneBy({ id: req.params.id });
  if (!edge) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(edge);
  res.json({ ok: true });
}));
