import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { Project, Collection, GenomicFile, Organism, Technique, EntityEdge } from '../entities/index.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

// ─── List projects ──────────────────────────────────────────

router.get('/', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(Project);
  const prjs = await repo.find({ order: { createdAt: 'DESC' } });

  // Enrich with file counts and storage totals via edges
  const edgeRepo = AppDataSource.getRepository(EntityEdge);
  const stats = await edgeRepo
    .createQueryBuilder('e')
    .innerJoin(GenomicFile, 'f', 'f.id = e.source_id')
    .select('e.target_id', 'projectId')
    .addSelect('COUNT(*)', 'fileCount')
    .addSelect('SUM(f.size_bytes)', 'totalBytes')
    .where("e.source_type = 'file' AND e.target_type = 'project' AND e.relation = 'belongs_to'")
    .groupBy('e.target_id')
    .getRawMany<{ projectId: string; fileCount: string; totalBytes: string }>();

  const statsMap = new Map(stats.map(s => [s.projectId, s]));

  res.json(prjs.map(p => ({
    ...p,
    fileCount:  parseInt(statsMap.get(p.id)?.fileCount  ?? '0'),
    totalBytes: parseInt(statsMap.get(p.id)?.totalBytes ?? '0'),
  })));
}));

// ─── Create project ─────────────────────────────────────────

router.post('/', asyncWrap(async (req, res) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const repo = AppDataSource.getRepository(Project);
  const prj  = repo.create({ name, description: description ?? null });
  await repo.save(prj);
  res.status(201).json(prj);
}));

// ─── Delete project ─────────────────────────────────────────

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Project);
  const project = await repo.findOneBy({ id: req.params.id });
  if (!project) { res.status(404).json({ error: 'not found' }); return; }

  await edges.cascadeDelete({ type: 'project', id: project.id });
  await repo.remove(project);
  res.json({ ok: true });
}));

// ─── Project tree ───────────────────────────────────────────

function organismDisplay(o: Organism): string {
  return `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`;
}

router.get('/:id/tree', asyncWrap(async (req, res) => {
  const projectId = req.params.id;
  const projRepo = AppDataSource.getRepository(Project);
  const project = await projRepo.findOneBy({ id: projectId });
  if (!project) { res.status(404).json({ error: 'not found' }); return; }

  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  // Find collection IDs belonging to this project
  const colEdges = await edgeRepo.find({
    where: { targetType: 'project' as any, targetId: projectId, sourceType: 'collection' as any, relation: 'belongs_to' as any },
  });
  const colIds = colEdges.map(e => e.sourceId);

  // Load collections
  const colRepo = AppDataSource.getRepository(Collection);
  const collections = colIds.length
    ? await colRepo.createQueryBuilder('c')
        .where('c.id IN (:...ids)', { ids: colIds })
        .orderBy('c.created_at', 'DESC')
        .getMany()
    : [];

  // Load all edges for collections (type, organism)
  const allColEdges = colIds.length
    ? await edgeRepo.createQueryBuilder('e')
        .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'collection', ids: colIds })
        .getMany()
    : [];

  const typeIdsByCol = new Map<string, string>();
  const orgIdsByCol = new Map<string, string>();
  for (const e of allColEdges) {
    if (e.relation === 'has_type') typeIdsByCol.set(e.sourceId, e.targetId);
    if (e.relation === 'targets' && e.targetType === 'organism') orgIdsByCol.set(e.sourceId, e.targetId);
  }

  // Load techniques and organisms
  const allTypeIds = [...new Set(typeIdsByCol.values())];
  const allOrgIds = [...new Set(orgIdsByCol.values())];
  const typeMap = new Map<string, Technique>();
  const orgMap = new Map<string, Organism>();

  if (allTypeIds.length) {
    const types = await AppDataSource.getRepository(Technique).findByIds(allTypeIds);
    types.forEach(t => typeMap.set(t.id, t));
  }
  if (allOrgIds.length) {
    const orgs = await AppDataSource.getRepository(Organism).findByIds(allOrgIds);
    orgs.forEach(o => orgMap.set(o.id, o));
  }

  // Find files belonging to each collection
  const fileEdges = colIds.length
    ? await edgeRepo.find({
        where: { sourceType: 'file' as any, targetType: 'collection' as any, relation: 'belongs_to' as any },
      })
    : [];
  const fileIdsByCol = new Map<string, string[]>();
  const allFileIds: string[] = [];
  for (const e of fileEdges) {
    if (colIds.includes(e.targetId)) {
      const list = fileIdsByCol.get(e.targetId) ?? [];
      list.push(e.sourceId);
      fileIdsByCol.set(e.targetId, list);
      if (!allFileIds.includes(e.sourceId)) allFileIds.push(e.sourceId);
    }
  }

  // Load all files for collections
  const fileRepo = AppDataSource.getRepository(GenomicFile);
  const colFiles = allFileIds.length
    ? await fileRepo.findByIds(allFileIds)
    : [];
  const fileMap = new Map(colFiles.map(f => [f.id, f]));

  // File counts via edges
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const allEntityIds = [projectId, ...colIds, nilUuid];
  const fileCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_type', 'targetType')
    .addSelect('e.target_id', 'targetId')
    .addSelect('COUNT(*)', 'count')
    .where("e.source_type = 'file' AND e.relation = 'belongs_to'")
    .andWhere('e.target_id IN (:...ids)', { ids: allEntityIds })
    .groupBy('e.target_type')
    .addGroupBy('e.target_id')
    .getRawMany<{ targetType: string; targetId: string; count: string }>();

  const countMap = new Map(fileCounts.map(r => [`${r.targetType}:${r.targetId}`, parseInt(r.count)]));
  const projectFileCount = (countMap.get(`project:${projectId}`) ?? 0);

  // External links via edges
  const linkEdges = await edgeRepo.createQueryBuilder('e')
    .where("e.relation = 'links_to'")
    .andWhere('e.source_id IN (:...ids)', { ids: allEntityIds })
    .orderBy('e.created_at', 'ASC')
    .getMany();

  const linksByEntity = new Map<string, EntityEdge[]>();
  for (const l of linkEdges) {
    const key = `${l.sourceType}:${l.sourceId}`;
    const list = linksByEntity.get(key) ?? [];
    list.push(l);
    linksByEntity.set(key, list);
  }

  function edgesToLinks(entityType: string, entityId: string) {
    return (linksByEntity.get(`${entityType}:${entityId}`) ?? []).map(e => ({
      id: e.id,
      url: (e.metadata as any)?.url ?? '',
      service: (e.metadata as any)?.service ?? 'link',
      label: (e.metadata as any)?.label ?? null,
      createdAt: e.createdAt,
    }));
  }

  res.json({
    ...project,
    fileCount: projectFileCount,
    links: edgesToLinks('project', projectId),
    collections: collections.map(col => {
      const typeId = typeIdsByCol.get(col.id);
      const orgId = orgIdsByCol.get(col.id);
      const tech = typeId ? typeMap.get(typeId) : null;
      const org = orgId ? orgMap.get(orgId) : null;
      const fIds = fileIdsByCol.get(col.id) ?? [];

      return {
        id: col.id,
        name: col.name,
        description: col.description,
        kind: col.kind,
        metadata: col.metadata,
        technique: tech ? { id: tech.id, name: tech.name } : null,
        organismId: orgId ?? null,
        organismDisplay: org ? organismDisplay(org) : null,
        fileCount: countMap.get(`collection:${col.id}`) ?? 0,
        links: edgesToLinks('collection', col.id),
        files: fIds.map(fId => {
          const f = fileMap.get(fId);
          if (!f) return null;
          return {
            id: f.id,
            filename: f.filename,
            kind: f.kind,
            format: f.format,
            sizeBytes: Number(f.sizeBytes),
            status: f.status,
          };
        }).filter(Boolean),
      };
    }),
  });
}));

export default router;
