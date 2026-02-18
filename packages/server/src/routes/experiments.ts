import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, Experiment, Dataset, Organism, ExperimentType, EntityEdge } from '../entities/index.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

function organismDisplay(o: Organism): string {
  return `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`;
}

// ─── List experiments ───────────────────────────────────────

router.get('/', asyncWrap(async (req, res) => {
  const { projectId, organismId } = req.query as { projectId?: string; organismId?: string };

  const edgeRepo = AppDataSource.getRepository(EntityEdge);
  let filteredExpIds: string[] | null = null;

  // Filter by project — find experiments that belong_to project
  if (projectId) {
    const expEdges = await edgeRepo.find({
      where: { sourceType: 'experiment' as any, targetType: 'project' as any, targetId: projectId, relation: 'belongs_to' as any },
    });
    filteredExpIds = expEdges.map(e => e.sourceId);
  }

  // Filter by organism — find experiments that target organism
  if (organismId) {
    const orgEdges = await edgeRepo.find({
      where: { sourceType: 'experiment' as any, targetType: 'organism' as any, targetId: organismId, relation: 'targets' as any },
    });
    const orgExpIds = orgEdges.map(e => e.sourceId);
    filteredExpIds = filteredExpIds ? filteredExpIds.filter(id => orgExpIds.includes(id)) : orgExpIds;
  }

  const repo = AppDataSource.getRepository(Experiment);
  let experiments: Experiment[];

  if (filteredExpIds !== null) {
    experiments = filteredExpIds.length
      ? await repo.createQueryBuilder('e')
          .where('e.id IN (:...ids)', { ids: filteredExpIds })
          .orderBy('e.created_at', 'DESC')
          .getMany()
      : [];
  } else {
    experiments = await repo.find({ order: { createdAt: 'DESC' } });
  }

  if (!experiments.length) { res.json([]); return; }

  const expIds = experiments.map(e => e.id);

  // Load all edges from these experiments
  const allEdges = await edgeRepo.createQueryBuilder('e')
    .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'experiment', ids: expIds })
    .getMany();

  // Build maps: experiment → project, type, organism
  const projectIdByExp = new Map<string, string>();
  const typeIdByExp = new Map<string, string>();
  const orgIdByExp = new Map<string, string>();
  for (const e of allEdges) {
    if (e.relation === 'belongs_to' && e.targetType === 'project') projectIdByExp.set(e.sourceId, e.targetId);
    if (e.relation === 'has_type') typeIdByExp.set(e.sourceId, e.targetId);
    if (e.relation === 'targets' && e.targetType === 'organism') orgIdByExp.set(e.sourceId, e.targetId);
  }

  // Load related entities
  const { Project } = await import('../entities/index.js');
  const allProjectIds = [...new Set(projectIdByExp.values())];
  const allTypeIds = [...new Set(typeIdByExp.values())];
  const allOrgIds = [...new Set(orgIdByExp.values())];

  const projectMap = new Map<string, { id: string; name: string }>();
  const typeMap = new Map<string, ExperimentType>();
  const orgMap = new Map<string, Organism>();

  if (allProjectIds.length) {
    const projects = await AppDataSource.getRepository(Project).findByIds(allProjectIds);
    projects.forEach(p => projectMap.set(p.id, p));
  }
  if (allTypeIds.length) {
    const types = await AppDataSource.getRepository(ExperimentType).findByIds(allTypeIds);
    types.forEach(t => typeMap.set(t.id, t));
  }
  if (allOrgIds.length) {
    const orgs = await AppDataSource.getRepository(Organism).findByIds(allOrgIds);
    orgs.forEach(o => orgMap.set(o.id, o));
  }

  // File counts via edges
  const fileCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_id', 'targetId')
    .addSelect('COUNT(*)', 'fileCount')
    .where("e.source_type = 'file' AND e.target_type = 'experiment' AND e.relation = 'belongs_to'")
    .andWhere('e.target_id IN (:...ids)', { ids: expIds })
    .groupBy('e.target_id')
    .getRawMany<{ targetId: string; fileCount: string }>();
  const fileMap = new Map(fileCounts.map(s => [s.targetId, parseInt(s.fileCount)]));

  // Dataset counts via edges
  const datasetCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_id', 'targetId')
    .addSelect('COUNT(*)', 'datasetCount')
    .where("e.source_type = 'dataset' AND e.target_type = 'experiment' AND e.relation = 'belongs_to'")
    .andWhere('e.target_id IN (:...ids)', { ids: expIds })
    .groupBy('e.target_id')
    .getRawMany<{ targetId: string; datasetCount: string }>();
  const datasetMap = new Map(datasetCounts.map(s => [s.targetId, parseInt(s.datasetCount)]));

  res.json(experiments.map(e => {
    const pId = projectIdByExp.get(e.id);
    const tId = typeIdByExp.get(e.id);
    const oId = orgIdByExp.get(e.id);
    const prj = pId ? projectMap.get(pId) : null;
    const et = tId ? typeMap.get(tId) : null;
    const org = oId ? orgMap.get(oId) : null;

    return {
      id: e.id,
      name: e.name,
      description: e.description,
      experimentTypeId: tId ?? null,
      experimentTypeName: et?.name ?? null,
      status: e.status,
      experimentDate: e.experimentDate,
      createdBy: e.createdBy,
      projectId: pId ?? null,
      projectName: prj?.name ?? null,
      organismId: oId ?? null,
      organismDisplay: org ? organismDisplay(org) : null,
      fileCount: fileMap.get(e.id) ?? 0,
      datasetCount: datasetMap.get(e.id) ?? 0,
      createdAt: e.createdAt,
    };
  }));
}));

// ─── Get experiment detail ──────────────────────────────────

router.get('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Experiment);
  const exp = await repo.findOneBy({ id: req.params.id });
  if (!exp) { res.status(404).json({ error: 'not found' }); return; }

  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  // Load all edges from this experiment
  const expEdges = await edgeRepo.find({
    where: { sourceType: 'experiment' as any, sourceId: exp.id },
  });

  let projectId: string | null = null;
  let typeId: string | null = null;
  let orgId: string | null = null;
  for (const e of expEdges) {
    if (e.relation === 'belongs_to' && e.targetType === 'project') projectId = e.targetId;
    if (e.relation === 'has_type') typeId = e.targetId;
    if (e.relation === 'targets' && e.targetType === 'organism') orgId = e.targetId;
  }

  // Load related entities
  const { Project } = await import('../entities/index.js');
  const project = projectId ? await AppDataSource.getRepository(Project).findOneBy({ id: projectId }) : null;
  const expType = typeId ? await AppDataSource.getRepository(ExperimentType).findOneBy({ id: typeId }) : null;
  const organism = orgId ? await AppDataSource.getRepository(Organism).findOneBy({ id: orgId }) : null;

  // Load datasets belonging to this experiment
  const dsEdges = await edgeRepo.find({
    where: { sourceType: 'dataset' as any, targetType: 'experiment' as any, targetId: exp.id, relation: 'belongs_to' as any },
  });
  const dsIds = dsEdges.map(e => e.sourceId);
  const datasets = dsIds.length
    ? await AppDataSource.getRepository(Dataset).findByIds(dsIds)
    : [];

  // File counts per dataset + experiment total
  const allIds = [exp.id, ...dsIds, '00000000-0000-0000-0000-000000000000'];
  const fileCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_type', 'targetType')
    .addSelect('e.target_id', 'targetId')
    .addSelect('COUNT(*)', 'count')
    .where("e.source_type = 'file' AND e.relation = 'belongs_to'")
    .andWhere('e.target_id IN (:...ids)', { ids: allIds })
    .groupBy('e.target_type')
    .addGroupBy('e.target_id')
    .getRawMany<{ targetType: string; targetId: string; count: string }>();

  const countMap = new Map(fileCounts.map(r => [`${r.targetType}:${r.targetId}`, parseInt(r.count)]));
  const totalFiles = countMap.get(`experiment:${exp.id}`) ?? 0;

  // External links via edges
  const linkEdgeIds = [exp.id, ...dsIds];
  const linkEdges = await edgeRepo.createQueryBuilder('e')
    .where("e.relation = 'links_to'")
    .andWhere('e.source_id IN (:...ids)', { ids: [...linkEdgeIds, '00000000-0000-0000-0000-000000000000'] })
    .orderBy('e.created_at', 'ASC')
    .getMany();

  const linksByEntity = new Map<string, typeof linkEdges>();
  for (const l of linkEdges) {
    const key = l.sourceId;
    const list = linksByEntity.get(key) ?? [];
    list.push(l);
    linksByEntity.set(key, list);
  }

  function edgesToLinks(entityId: string) {
    return (linksByEntity.get(entityId) ?? []).map(e => ({
      id: e.id,
      url: (e.metadata as any)?.url ?? '',
      service: (e.metadata as any)?.service ?? 'link',
      label: (e.metadata as any)?.label ?? null,
      createdAt: e.createdAt,
    }));
  }

  res.json({
    id: exp.id,
    name: exp.name,
    description: exp.description,
    experimentType: expType ? { id: expType.id, name: expType.name } : null,
    organismId: orgId,
    organismDisplay: organism ? organismDisplay(organism) : null,
    status: exp.status,
    experimentDate: exp.experimentDate,
    createdBy: exp.createdBy,
    projectId,
    projectName: project?.name ?? null,
    fileCount: totalFiles,
    links: edgesToLinks(exp.id),
    datasets: datasets.map(ds => ({
      id: ds.id,
      name: ds.name,
      kind: ds.kind,
      description: ds.description,
      condition: ds.condition,
      replicate: ds.replicate,
      metadata: ds.metadata,
      tags: ds.tags,
      fileCount: countMap.get(`dataset:${ds.id}`) ?? 0,
      links: edgesToLinks(ds.id),
    })),
  });
}));

// ─── Create experiment ──────────────────────────────────────

router.post('/', asyncWrap(async (req, res) => {
  const {
    name, projectId, experimentTypeId,
    description, experimentDate, organismId, status,
  } = req.body as {
    name: string; projectId?: string; experimentTypeId: string;
    description?: string; experimentDate?: string;
    organismId: string; status?: string;
  };
  if (!name || !experimentTypeId || !organismId) {
    res.status(400).json({ error: 'name, experimentTypeId, and organismId required' }); return;
  }

  const repo = AppDataSource.getRepository(Experiment);
  const exp = repo.create({
    name,
    description: description ?? null,
    status: (status as 'active' | 'complete' | 'archived') ?? 'active',
    experimentDate: experimentDate ?? null,
    createdBy: (res.locals.user as User)?.email ?? null,
  });
  await repo.save(exp);

  const userId = (res.locals.user as User)?.id ?? null;

  // Create edges
  if (projectId) {
    await edges.link({ type: 'experiment', id: exp.id }, { type: 'project', id: projectId }, 'belongs_to', null, userId);
  }
  await edges.link({ type: 'experiment', id: exp.id }, { type: 'organism', id: organismId }, 'targets', null, userId);
  await edges.link(
    { type: 'experiment', id: exp.id },
    { type: 'experiment' as any, id: experimentTypeId },
    'has_type',
    null,
    userId,
  );

  res.status(201).json(exp);
}));

// ─── Update experiment ──────────────────────────────────────

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Experiment);
  const exp = await repo.findOneBy({ id: req.params.id });
  if (!exp) { res.status(404).json({ error: 'not found' }); return; }

  const {
    name, experimentTypeId, description, status,
    experimentDate, organismId, projectId,
  } = req.body as Partial<{
    name: string; experimentTypeId: string;
    description: string; status: string;
    experimentDate: string; organismId: string; projectId: string;
  }>;

  if (name !== undefined) exp.name = name;
  if (description !== undefined) exp.description = description || null;
  if (status !== undefined) exp.status = status as 'active' | 'complete' | 'archived';
  if (experimentDate !== undefined) exp.experimentDate = experimentDate || null;

  await repo.save(exp);

  const userId = (res.locals.user as User)?.id ?? null;
  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  // Update project edge
  if (projectId !== undefined) {
    await edgeRepo.delete({ sourceType: 'experiment' as any, sourceId: exp.id, targetType: 'project' as any, relation: 'belongs_to' as any });
    if (projectId) {
      await edges.link({ type: 'experiment', id: exp.id }, { type: 'project', id: projectId }, 'belongs_to', null, userId);
    }
  }

  // Update organism edge
  if (organismId !== undefined) {
    await edgeRepo.delete({ sourceType: 'experiment' as any, sourceId: exp.id, targetType: 'organism' as any, relation: 'targets' as any });
    if (organismId) {
      await edges.link({ type: 'experiment', id: exp.id }, { type: 'organism', id: organismId }, 'targets', null, userId);
    }
  }

  // Update type edge
  if (experimentTypeId !== undefined) {
    await edgeRepo.delete({ sourceType: 'experiment' as any, sourceId: exp.id, relation: 'has_type' as any });
    if (experimentTypeId) {
      await edges.link({ type: 'experiment', id: exp.id }, { type: 'experiment' as any, id: experimentTypeId }, 'has_type', null, userId);
    }
  }

  res.json(exp);
}));

// ─── Delete experiment ──────────────────────────────────────

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Experiment);
  const exp = await repo.findOneBy({ id: req.params.id });
  if (!exp) { res.status(404).json({ error: 'not found' }); return; }

  await edges.cascadeDelete({ type: 'experiment', id: exp.id });
  await repo.remove(exp);
  res.json({ ok: true });
}));

export default router;
