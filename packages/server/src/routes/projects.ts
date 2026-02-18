import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { Project, Experiment, Dataset, GenomicFile, Organism, ExperimentType, EntityEdge } from '../entities/index.js';
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

  // Find experiment IDs belonging to this project
  const expEdges = await edgeRepo.find({
    where: { targetType: 'project' as any, targetId: projectId, sourceType: 'experiment' as any, relation: 'belongs_to' as any },
  });
  const expIds = expEdges.map(e => e.sourceId);

  // Load experiments
  const expRepo = AppDataSource.getRepository(Experiment);
  const experiments = expIds.length
    ? await expRepo.createQueryBuilder('e')
        .where('e.id IN (:...ids)', { ids: expIds })
        .orderBy('e.created_at', 'DESC')
        .getMany()
    : [];

  // Load all edges for experiments (type, organism)
  const allExpEdges = expIds.length
    ? await edgeRepo.createQueryBuilder('e')
        .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'experiment', ids: expIds })
        .getMany()
    : [];

  // Build type map and organism map
  const typeIdsByExp = new Map<string, string>();
  const orgIdsByExp = new Map<string, string>();
  for (const e of allExpEdges) {
    if (e.relation === 'has_type') typeIdsByExp.set(e.sourceId, e.targetId);
    if (e.relation === 'targets' && e.targetType === 'organism') orgIdsByExp.set(e.sourceId, e.targetId);
  }

  // Load experiment types and organisms
  const allTypeIds = [...new Set(typeIdsByExp.values())];
  const allOrgIds = [...new Set(orgIdsByExp.values())];
  const typeMap = new Map<string, ExperimentType>();
  const orgMap = new Map<string, Organism>();

  if (allTypeIds.length) {
    const types = await AppDataSource.getRepository(ExperimentType).findByIds(allTypeIds);
    types.forEach(t => typeMap.set(t.id, t));
  }
  if (allOrgIds.length) {
    const orgs = await AppDataSource.getRepository(Organism).findByIds(allOrgIds);
    orgs.forEach(o => orgMap.set(o.id, o));
  }

  // Find datasets belonging to each experiment
  const datasetEdges = expIds.length
    ? await edgeRepo.find({
        where: { sourceType: 'dataset' as any, targetType: 'experiment' as any, relation: 'belongs_to' as any },
      })
    : [];
  const datasetIdsByExp = new Map<string, string[]>();
  const allDatasetIds: string[] = [];
  for (const e of datasetEdges) {
    if (expIds.includes(e.targetId)) {
      const list = datasetIdsByExp.get(e.targetId) ?? [];
      list.push(e.sourceId);
      datasetIdsByExp.set(e.targetId, list);
      allDatasetIds.push(e.sourceId);
    }
  }

  // Also find datasets directly belonging to the project
  const projectDatasetEdges = await edgeRepo.find({
    where: { sourceType: 'dataset' as any, targetType: 'project' as any, targetId: projectId, relation: 'belongs_to' as any },
  });
  for (const e of projectDatasetEdges) {
    if (!allDatasetIds.includes(e.sourceId)) allDatasetIds.push(e.sourceId);
  }

  // Load all datasets
  const dsRepo = AppDataSource.getRepository(Dataset);
  const datasets = allDatasetIds.length
    ? await dsRepo.findByIds(allDatasetIds)
    : [];
  const dsMap = new Map(datasets.map(d => [d.id, d]));

  // File counts via edges
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const allEntityIds = [projectId, ...expIds, ...allDatasetIds, nilUuid];
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
    experiments: experiments.map(exp => {
      const typeId = typeIdsByExp.get(exp.id);
      const orgId = orgIdsByExp.get(exp.id);
      const et = typeId ? typeMap.get(typeId) : null;
      const org = orgId ? orgMap.get(orgId) : null;
      const dsIds = datasetIdsByExp.get(exp.id) ?? [];

      return {
        id: exp.id,
        name: exp.name,
        description: exp.description,
        experimentType: et ? { id: et.id, name: et.name } : null,
        organismId: orgId ?? null,
        organismDisplay: org ? organismDisplay(org) : null,
        status: exp.status,
        fileCount: countMap.get(`experiment:${exp.id}`) ?? 0,
        links: edgesToLinks('experiment', exp.id),
        datasets: dsIds.map(dsId => {
          const ds = dsMap.get(dsId);
          if (!ds) return null;
          return {
            id: ds.id,
            name: ds.name,
            kind: ds.kind,
            description: ds.description,
            condition: ds.condition,
            replicate: ds.replicate,
            metadata: ds.metadata,
            tags: ds.tags,
            fileCount: countMap.get(`dataset:${ds.id}`) ?? 0,
            links: edgesToLinks('dataset', ds.id),
          };
        }).filter(Boolean),
      };
    }),
  });
}));

export default router;
