/**
 * EdgeService — graph traversal helpers for the entity_edges table.
 *
 * All relationship queries go through this module instead of FK joins.
 *
 * @module
 */

import { AppDataSource } from '../app_data.js';
import { EntityEdge, GenomicFile, type EntityType, type EdgeRelation } from '../entities/index.js';
import { deleteObject } from './s3.js';

interface EntityRef {
  type: EntityType;
  id: string;
}

const edgeRepo = () => AppDataSource.getRepository(EntityEdge);

/** Create an edge (upsert — ignores if the exact edge already exists). */
export async function link(
  source: EntityRef,
  target: EntityRef,
  relation: EdgeRelation,
  metadata?: Record<string, unknown> | null,
  createdBy?: string | null,
): Promise<EntityEdge> {
  const repo = edgeRepo();

  // Check for existing edge
  const existing = await repo.findOneBy({
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relation,
  });
  if (existing) return existing;

  const edge = repo.create({
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relation,
    metadata: metadata ?? null,
    createdBy: createdBy ?? null,
  });
  return repo.save(edge);
}

/** Remove a specific edge. */
export async function unlink(
  source: EntityRef,
  target: EntityRef,
  relation: EdgeRelation,
): Promise<boolean> {
  const result = await edgeRepo().delete({
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relation,
  });
  return (result.affected ?? 0) > 0;
}

/** Forward traversal: get all targets reachable from source via relation. */
export async function getLinked(
  source: EntityRef,
  relation: EdgeRelation,
  targetType?: EntityType,
): Promise<EntityEdge[]> {
  const qb = edgeRepo().createQueryBuilder('e')
    .where('e.source_type = :st AND e.source_id = :sid', { st: source.type, sid: source.id })
    .andWhere('e.relation = :rel', { rel: relation });
  if (targetType) qb.andWhere('e.target_type = :tt', { tt: targetType });
  return qb.getMany();
}

/** Reverse traversal: get all sources that point to target via relation. */
export async function getReverseLinked(
  target: EntityRef,
  relation: EdgeRelation,
  sourceType?: EntityType,
): Promise<EntityEdge[]> {
  const qb = edgeRepo().createQueryBuilder('e')
    .where('e.target_type = :tt AND e.target_id = :tid', { tt: target.type, tid: target.id })
    .andWhere('e.relation = :rel', { rel: relation });
  if (sourceType) qb.andWhere('e.source_type = :st', { st: sourceType });
  return qb.getMany();
}

/** Full 1-hop neighborhood — all edges touching this entity (as source or target). */
export async function getNeighborhood(entity: EntityRef): Promise<EntityEdge[]> {
  return edgeRepo().createQueryBuilder('e')
    .where(
      '(e.source_type = :t AND e.source_id = :id) OR (e.target_type = :t AND e.target_id = :id)',
      { t: entity.type, id: entity.id },
    )
    .orderBy('e.created_at', 'ASC')
    .getMany();
}

/** Convenience: get external links (links_to edges) for an entity. */
export async function getExternalLinks(entity: EntityRef): Promise<EntityEdge[]> {
  return getLinked(entity, 'links_to');
}

/** Get all target IDs of a given type linked from source via any relation. */
export async function getLinkedIds(
  source: EntityRef,
  targetType: EntityType,
): Promise<string[]> {
  const edges = await edgeRepo().createQueryBuilder('e')
    .select('DISTINCT e.target_id', 'targetId')
    .where('e.source_type = :st AND e.source_id = :sid', { st: source.type, sid: source.id })
    .andWhere('e.target_type = :tt', { tt: targetType })
    .getRawMany<{ targetId: string }>();
  return edges.map(e => e.targetId);
}

/** Get all source IDs of a given type that point to target via any relation. */
export async function getReverseLinkedIds(
  target: EntityRef,
  sourceType: EntityType,
): Promise<string[]> {
  const edges = await edgeRepo().createQueryBuilder('e')
    .select('DISTINCT e.source_id', 'sourceId')
    .where('e.target_type = :tt AND e.target_id = :tid', { tt: target.type, tid: target.id })
    .andWhere('e.source_type = :st', { st: sourceType })
    .getRawMany<{ sourceId: string }>();
  return edges.map(e => e.sourceId);
}

/**
 * Remove all edges referencing an entity, and optionally cascade-delete
 * dependent entities based on the cascade rules.
 *
 * Cascade rules:
 *   project    → delete project's files, remove edges
 *   collection → detach files, remove edges
 *   file       → remove edges only
 */
export async function cascadeDelete(entity: EntityRef): Promise<void> {
  const repo = edgeRepo();

  if (entity.type === 'project') {
    // Delete all files that belong_to this project
    const fileIds = await getReverseLinkedIds(
      { type: 'project', id: entity.id },
      'file',
    );
    if (fileIds.length) {
      const fileRepo = AppDataSource.getRepository(GenomicFile);
      const files = await fileRepo.findByIds(fileIds);
      for (const f of files) {
        if (f.s3Key) await deleteObject(f.s3Key).catch(() => {});
        // Remove file's edges
        await repo.delete({ sourceType: 'file' as EntityType, sourceId: f.id });
        await repo.delete({ targetType: 'file' as EntityType, targetId: f.id });
        await fileRepo.remove(f);
      }
    }
  }

  // Remove all edges where this entity is source or target
  await repo.delete({ sourceType: entity.type, sourceId: entity.id });
  await repo.delete({ targetType: entity.type, targetId: entity.id });
}
