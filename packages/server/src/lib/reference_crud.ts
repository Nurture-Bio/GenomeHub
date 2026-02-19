import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import { asyncWrap } from './async_wrap.js';
import * as edges from './edge_service.js';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import type { EntityType } from '../entities/index.js';

interface ReferenceCrudOptions<T extends ObjectLiteral> {
  entity: EntityTarget<T>;
  /** Entity type name for edge reference checking on delete */
  entityType?: EntityType;
  orderBy?: { column: string; direction: 'ASC' | 'DESC' };
  normalizeName?: boolean;
  extraFields?: { name: string; default: unknown }[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

export function referenceCrudRouter<T extends ObjectLiteral>(opts: ReferenceCrudOptions<T>): Router {
  const {
    entity,
    orderBy = { column: 'name', direction: 'ASC' },
    extraFields = [],
  } = opts;

  const router = Router();

  router.get('/', asyncWrap(async (_req, res) => {
    const repo = AppDataSource.getRepository(entity);
    const items = await repo.find({ order: { [orderBy.column]: orderBy.direction } as any });
    res.json(items);
  }));

  router.post('/', asyncWrap(async (req, res) => {
    const { name, description, ...rest } = req.body as Record<string, unknown>;
    if (!name || (typeof name === 'string' && !name.trim())) {
      res.status(400).json({ error: 'name required' }); return;
    }

    const repo = AppDataSource.getRepository(entity);
    const fields: Record<string, unknown> = {
      name: opts.normalizeName ? normalizeName(name as string) : name,
      description: (description as string) ?? null,
    };
    for (const f of extraFields) {
      fields[f.name] = rest[f.name] ?? f.default;
    }
    const item = repo.create(fields as any);
    await repo.save(item);
    res.status(201).json(item);
  }));

  router.put('/:id', asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(entity);
    const item = await repo.findOneBy({ id: req.params.id } as any);
    if (!item) { res.status(404).json({ error: 'not found' }); return; }

    const { name, description, ...rest } = req.body as Record<string, unknown>;
    if (name !== undefined) {
      (item as any).name = opts.normalizeName ? normalizeName(name as string) : name;
    }
    if (description !== undefined) (item as any).description = description;
    for (const f of extraFields) {
      if (rest[f.name] !== undefined) (item as any)[f.name] = rest[f.name];
    }
    await repo.save(item);
    res.json(item);
  }));

  router.delete('/:id', asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(entity);
    const item = await repo.findOneBy({ id: req.params.id } as any);
    if (!item) { res.status(404).json({ error: 'not found' }); return; }
    if (opts.entityType) {
      const refs = await edges.countReferences({ type: opts.entityType, id: req.params.id });
      if (refs > 0) {
        res.status(409).json({ error: `Cannot delete: ${refs} item(s) still reference this.` });
        return;
      }
    }
    await repo.remove(item);
    res.json({ ok: true });
  }));

  return router;
}
