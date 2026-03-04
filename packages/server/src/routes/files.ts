import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import {
  User,
  GenomicFile,
  EntityEdge,
  Organism,
  Collection,
  type EdgeRelation,
} from '../entities/index.js';
import { createGunzip, constants } from 'zlib';
import { deleteObject, presignDownloadUrl, fetchS3Head, fetchS3Range } from '../lib/s3.js';
import { isLocal, readLocalHead, readLocalRange, deleteLocal } from '../lib/storage.js';
import { detectFormat, isConvertible } from '@genome-hub/shared';
import * as edges from '../lib/edge_service.js';
import { asyncWrap } from '../lib/async_wrap.js';
import { organismDisplay } from '../lib/display.js';
import { convertToParquet } from '../lib/parquet.js';
import {
  hydrateAttributes,
  extractBaseProfile,
  validateAttributeKeys,
  ALL_KEYS,
} from '../lib/data_profile.js';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// ── CloudFront signing for Parquet URLs ─────────────────────

let _cfPrivateKey: string | null = null;
const CF_DOMAIN = process.env.CF_DOMAIN;
const CF_KEY_PAIR_ID = process.env.CF_KEY_PAIR_ID;

async function getCfPrivateKey(): Promise<string> {
  if (_cfPrivateKey) return _cfPrivateKey;
  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-west-2' });
  const res = await ssm.send(
    new GetParameterCommand({
      Name: '/genome-hub/cloudfront-private-key',
      WithDecryption: true,
    }),
  );
  _cfPrivateKey = res.Parameter!.Value!;
  return _cfPrivateKey;
}

const router = Router();

// ─── Pipeline errors ────────────────────────────────────────

router.get(
  '/errors',
  asyncWrap(async (_req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const files = await repo
      .createQueryBuilder('f')
      .where('f.parquet_status = :status', { status: 'failed' })
      .orderBy('f.updated_at', 'DESC')
      .getMany();

    res.json(
      files.map((f) => ({
        id: f.id,
        filename: f.filename,
        sizeBytes: Number(f.sizeBytes),
        format: f.format,
        status: f.status,
        parquetStatus: f.parquetStatus,
        parquetError: f.parquetError,
        uploadedAt: f.uploadedAt,
        updatedAt: f.updatedAt,
      })),
    );
  }),
);

// ─── List files ─────────────────────────────────────────────

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const { organismId, collectionId, type } = req.query as {
      organismId?: string;
      collectionId?: string;
      type?: string;
    };

    const edgeRepo = AppDataSource.getRepository(EntityEdge);

    // Collect ID sets from each filter, then intersect
    const idSets: string[][] = [];

    async function addFilter(targetType: string, targetId: string, relation: string) {
      const found = await edgeRepo.find({
        where: {
          sourceType: 'file' as any,
          targetType: targetType as any,
          targetId,
          relation: relation as any,
        },
      });
      idSets.push(found.map((e) => e.sourceId));
    }

    if (collectionId) await addFilter('collection', collectionId, 'belongs_to');
    if (organismId) await addFilter('organism', organismId, 'from_organism');

    const filteredFileIds: string[] | null =
      idSets.length === 0
        ? null
        : idSets.reduce((acc, set) => acc.filter((id) => set.includes(id)));

    const repo = AppDataSource.getRepository(GenomicFile);
    let qb = repo.createQueryBuilder('f').orderBy('f.uploaded_at', 'DESC');

    if (filteredFileIds !== null) {
      if (!filteredFileIds.length) {
        res.json([]);
        return;
      }
      qb = qb.where('f.id IN (:...ids)', { ids: filteredFileIds });
    }

    if (type) {
      qb =
        filteredFileIds !== null
          ? qb.andWhere(':type = ANY(f.type)', { type })
          : qb.where(':type = ANY(f.type)', { type });
    }

    const files = await qb.getMany();
    if (!files.length) {
      res.json([]);
      return;
    }

    const fileIds = files.map((f) => f.id);

    // Load all edges FROM these files
    const allEdges = await edgeRepo
      .createQueryBuilder('e')
      .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'file', ids: fileIds })
      .getMany();

    // Build maps — many-to-many for collections and organisms
    const collectionIdsByFile = new Map<string, string[]>();
    const organismIdsByFile = new Map<string, string[]>();

    for (const e of allEdges) {
      if (e.relation === 'belongs_to' && e.targetType === 'collection') {
        const arr = collectionIdsByFile.get(e.sourceId) ?? [];
        arr.push(e.targetId);
        collectionIdsByFile.set(e.sourceId, arr);
      }
      if (e.relation === 'from_organism') {
        const arr = organismIdsByFile.get(e.sourceId) ?? [];
        arr.push(e.targetId);
        organismIdsByFile.set(e.sourceId, arr);
      }
    }

    // Load related entities
    const allColIds = [...new Set([...collectionIdsByFile.values()].flat())];
    const allOrgIds = [...new Set([...organismIdsByFile.values()].flat())];

    const colMap = new Map<string, Collection>();
    const orgMap = new Map<string, Organism>();

    if (allColIds.length) {
      const cols = await AppDataSource.getRepository(Collection).findByIds(allColIds);
      cols.forEach((c) => colMap.set(c.id, c));
    }
    if (allOrgIds.length) {
      const orgs = await AppDataSource.getRepository(Organism).findByIds(allOrgIds);
      orgs.forEach((o) => orgMap.set(o.id, o));
    }

    res.json(
      files.map((f) => {
        const orgIds = organismIdsByFile.get(f.id) ?? [];
        const colIds = collectionIdsByFile.get(f.id) ?? [];

        return {
          id: f.id,
          filename: f.filename,
          s3Key: f.s3Key,
          sizeBytes: Number(f.sizeBytes),
          format: f.format,
          types: f.type,
          md5: f.md5,
          status: f.status,
          uploadedAt: f.uploadedAt,
          description: f.description,
          tags: f.tags,
          organisms: orgIds.map((oId) => {
            const org = orgMap.get(oId);
            return { id: oId, displayName: org ? organismDisplay(org) : oId };
          }),
          collections: colIds.map((cId) => ({ id: cId, name: colMap.get(cId)?.name ?? null })),
          uploadedBy: f.uploadedBy,
          dataProfile: f.dataProfile ?? null,
        };
      }),
    );
  }),
);

// ─── Parquet presigned URL ──────────────────────────────────

router.get(
  '/:id/parquet-url',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    // ── Fast path: file is already Parquet — serve s3Key directly ──
    if (detectFormat(file.filename) === 'parquet') {
      let dataProfile = file.dataProfile;
      if (!dataProfile) {
        try {
          dataProfile = await extractBaseProfile(file.s3Key);
          repo.update(file.id, { dataProfile }).catch(() => {});
        } catch (err) {
          console.error(
            JSON.stringify({
              tag: '[BASE_PROFILE_FAILED]',
              fileId: file.id,
              s3Key: file.s3Key,
              error: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
      if (isLocal) {
        res.json({
          status: 'ready',
          url: `/api/storage/${file.s3Key}`,
          dataProfile: dataProfile ?? null,
        });
      } else if (CF_DOMAIN && CF_KEY_PAIR_ID) {
        const privateKey = await getCfPrivateKey();
        const url = getCloudFrontSignedUrl({
          url: `https://${CF_DOMAIN}/parquet/${file.s3Key}`,
          keyPairId: CF_KEY_PAIR_ID,
          privateKey,
          dateLessThan: new Date(Date.now() + 3600 * 1000).toISOString(),
        });
        res.json({ status: 'ready', url, dataProfile: dataProfile ?? null });
      } else {
        const url = await presignDownloadUrl(file.s3Key, 'preview.parquet');
        res.json({ status: 'ready', url, dataProfile: dataProfile ?? null });
      }
      return;
    }

    if (!isConvertible(file.filename)) {
      res.json({ status: 'unavailable', reason: 'format not supported for dataset preview' });
      return;
    }
    if (Number(file.sizeBytes) > 1.5 * 1024 * 1024 * 1024) {
      res.json({ status: 'unavailable', reason: 'file too large' });
      return;
    }

    // Use parquetStatus if set, otherwise infer from parquetS3Key
    const status = file.parquetStatus ?? (file.parquetS3Key ? 'ready' : null);

    if (status === 'failed') {
      res.json({ status: 'failed', error: file.parquetError ?? 'Unknown error' });
      return;
    }

    // No status and no parquetS3Key → file predates the Parquet feature.
    // Atomically claim the conversion so only one DuckDB process spawns per file.
    if (!status && !file.parquetS3Key) {
      const updateResult = await repo
        .createQueryBuilder()
        .update(GenomicFile)
        .set({ parquetStatus: 'converting' })
        .where('id = :id AND parquet_status IS NULL', { id: file.id })
        .execute();

      // Only the single request that won the race gets to run DuckDB
      if (updateResult.affected === 1) {
        const parquetKey = file.s3Key + '.parquet';
        convertToParquet(
          file.s3Key,
          parquetKey,
          detectFormat(file.filename),
          Number(file.sizeBytes),
          file.id,
        )
          .then(async () => {
            try {
              const base = await extractBaseProfile(parquetKey);
              await repo.update(file.id, { parquetS3Key: parquetKey, dataProfile: base });
              await hydrateAttributes(parquetKey, file.id, base, ALL_KEYS);
            } catch (e) {
              console.error(
                JSON.stringify({
                  tag: '[EAGER_PROFILE_FAILED]',
                  fileId: file.id,
                  error: e instanceof Error ? e.message : String(e),
                }),
              );
            }
            await repo.update(file.id, { parquetStatus: 'ready' });
          })
          .catch(async (err) => {
            console.error(
              JSON.stringify({
                tag: '[PARQUET_PIPELINE_FAILED]',
                fileId: file.id,
                s3Key: file.s3Key,
                error: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString(),
              }),
            );
            const errMsg = err instanceof Error ? err.message : String(err);
            await repo.update(file.id, { parquetStatus: 'failed', parquetError: errMsg });
          });
      }

      res.json({ status: 'converting' });
      return;
    }

    if (status !== 'ready' || !file.parquetS3Key) {
      res.json({ status: 'converting' });
      return;
    }

    // Ensure base profile exists (schema + rowCount — free, from Parquet footer)
    let dataProfile = file.dataProfile;
    if (!dataProfile) {
      try {
        dataProfile = await extractBaseProfile(file.parquetS3Key);
        // Fire-and-forget persist
        repo.update(file.id, { dataProfile: dataProfile }).catch(() => {});
      } catch (err) {
        console.error(
          JSON.stringify({
            tag: '[BASE_PROFILE_FAILED]',
            fileId: file.id,
            parquetS3Key: file.parquetS3Key,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    // Local mode — serve via express.static
    if (isLocal) {
      const url = `/api/storage/${file.parquetS3Key}`;
      res.json({ status: 'ready', url, dataProfile: dataProfile ?? null });
      return;
    }

    // CloudFront signed URL (production) or S3 presigned URL (local dev fallback)
    if (CF_DOMAIN && CF_KEY_PAIR_ID) {
      const privateKey = await getCfPrivateKey();
      const url = getCloudFrontSignedUrl({
        url: `https://${CF_DOMAIN}/parquet/${file.parquetS3Key}`,
        keyPairId: CF_KEY_PAIR_ID,
        privateKey,
        dateLessThan: new Date(Date.now() + 3600 * 1000).toISOString(),
      });
      res.json({ status: 'ready', url, dataProfile: dataProfile ?? null });
    } else {
      const url = await presignDownloadUrl(file.parquetS3Key, 'preview.parquet');
      res.json({ status: 'ready', url, dataProfile: dataProfile ?? null });
    }
  }),
);

// ─── Helpers ────────────────────────────────────────────────

/** Resolve the S3 key that points to the Parquet data for a file.
 *  Native parquet files use s3Key directly; converted files use parquetS3Key. */
function resolveParquetKey(file: GenomicFile): string | null {
  if (detectFormat(file.filename) === 'parquet') return file.s3Key;
  if (file.parquetS3Key && (file.parquetStatus === 'ready' || !file.parquetStatus))
    return file.parquetS3Key;
  return null;
}

// ─── Data profile (demand-driven lazy hydration) ────────────

router.get(
  '/:id/data-profile',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const pqKey = resolveParquetKey(file);
    if (!pqKey) {
      res.status(409).json({ error: 'parquet not ready' });
      return;
    }

    // Parse and validate requested attributes
    const rawAttrs = ((req.query.attributes as string) ?? '').split(',').filter(Boolean);
    const requestedKeys = validateAttributeKeys(rawAttrs);

    const profile = file.dataProfile;
    const missing = profile ? requestedKeys.filter((k) => profile[k] === undefined) : requestedKeys;

    // Fast path: everything already cached — return 200 immediately
    if (missing.length === 0) {
      res.json({ profile: profile ?? null });
      return;
    }

    // Slow path: kick off hydration as fire-and-forget, return 202
    hydrateAttributes(pqKey, file.id, profile, missing).catch((err) => {
      console.error(
        JSON.stringify({
          tag: '[DATA_PROFILE_HYDRATE_FAILED]',
          fileId: file.id,
          parquetS3Key: pqKey,
          requestedKeys: missing,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    });

    res.status(202).json({ status: 'computing', profile: profile ?? null });
  }),
);

// ─── Re-profile (clear and recompute) ──────────────────────

router.post(
  '/:id/reprofile',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const pqKey = resolveParquetKey(file);
    if (!pqKey) {
      res.status(409).json({ error: 'parquet not ready' });
      return;
    }

    // Clear existing profile
    await repo.update(file.id, { dataProfile: null });

    // Re-extract base profile with DESCRIBE (logical types)
    try {
      const baseProfile = await extractBaseProfile(pqKey);
      await repo.update(file.id, { dataProfile: baseProfile });
      res.json({ ok: true, profile: baseProfile });
    } catch (err) {
      console.error(
        JSON.stringify({
          tag: '[REPROFILE_FAILED]',
          fileId: file.id,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
      res.status(500).json({ error: 'Re-profiling failed' });
    }
  }),
);

// ─── File preview (first N lines) ──────────────────────────

function decompressPartial(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve) => {
    const gunzip = createGunzip({ finishFlush: constants.Z_SYNC_FLUSH });
    const chunks: Buffer[] = [];
    gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks)));
    gunzip.on('error', () => resolve(Buffer.concat(chunks)));
    gunzip.end(buf);
  });
}

router.get(
  '/:id/preview',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const fmt = detectFormat(file.filename);

    const isGz = file.filename.toLowerCase().endsWith('.gz');
    const CHUNK = 128 * 1024; // 128 KB per page
    const PAGE_SIZE = 50;
    const startByte = isGz ? 0 : Math.max(0, parseInt((req.query.startByte as string) || '0', 10));

    try {
      let buf: Buffer;
      if (isGz) {
        const compressed = isLocal
          ? await readLocalHead(file.s3Key, CHUNK)
          : await fetchS3Head(file.s3Key, CHUNK);
        buf = await decompressPartial(compressed);
      } else {
        buf = isLocal
          ? await readLocalRange(file.s3Key, startByte, CHUNK)
          : await fetchS3Range(file.s3Key, startByte, CHUNK);
      }

      // Binary sniff: if the first 8 KB contains a null byte, it's not text
      if (buf.slice(0, 8192).includes(0)) {
        res.json({
          lines: [],
          truncated: false,
          previewable: false,
          format: fmt,
          nextStartByte: null,
        });
        return;
      }

      const isLastChunk = buf.length < CHUNK;
      const text = buf.toString('utf-8');

      // JSON: pretty-print a parsed preview rather than showing raw minified text
      if (fmt === 'json') {
        let parsed: unknown;

        // Try full parse (works for small files or already-complete chunk)
        try {
          parsed = JSON.parse(text);
        } catch {
          /* try partial */
        }

        // For truncated minified arrays, recover everything up to the last complete element
        if (parsed === undefined) {
          const lastClose = text.lastIndexOf('},');
          if (lastClose > 0) {
            const prefix =
              (text.trimStart().startsWith('[') ? '' : '[') + text.slice(0, lastClose + 1) + ']';
            try {
              parsed = JSON.parse(prefix);
            } catch {
              /* give up */
            }
          }
        }

        if (parsed !== undefined) {
          const lines = JSON.stringify(parsed, null, 2).split('\n');
          res.json({
            lines,
            truncated: !isLastChunk,
            previewable: true,
            format: fmt,
            nextStartByte: null,
          });
          return;
        }
        // Unparseable JSON — fall through to normal line handling
      }

      // Drop the potentially partial last line unless we're at EOF
      const safeText =
        !isLastChunk && text.includes('\n') ? text.slice(0, text.lastIndexOf('\n') + 1) : text;

      const LINE_MAX = 500; // chars — prevents multi-MB lines from reaching the client
      const allLines = safeText
        .split('\n')
        .filter((l, i, arr) => i < arr.length - 1 || l.length > 0);
      const rawLines = allLines.slice(0, PAGE_SIZE);
      const anyLong = rawLines.some((l) => l.length > LINE_MAX);
      const lines = rawLines.map((l) => (l.length > LINE_MAX ? l.slice(0, LINE_MAX) + '…' : l));
      const hasMore = !isLastChunk || allLines.length > PAGE_SIZE;

      // If any line was truncated the file has very long lines (e.g. minified JSON).
      // Stop pagination — there's nothing useful to show on subsequent pages.
      let nextStartByte: number | null = null;
      if (hasMore && !isGz && !anyLong) {
        nextStartByte = startByte + Buffer.byteLength(rawLines.join('\n') + '\n', 'utf-8');
      }

      res.json({ lines, truncated: hasMore, previewable: true, format: fmt, nextStartByte });
    } catch (err) {
      res.json({
        lines: [],
        truncated: false,
        previewable: false,
        format: fmt,
        nextStartByte: null,
        error: 'Preview unavailable',
      });
    }
  }),
);

// ─── File detail ────────────────────────────────────────────

router.get(
  '/:id',
  asyncWrap(async (req, res) => {
    // Avoid matching /:id/download or /:id/provenance
    if (req.params.id === 'download' || req.params.id === 'provenance') return;

    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    // All edges touching this file
    const neighborhood = await edges.getNeighborhood({ type: 'file', id: file.id });

    const collectionIds: string[] = [];
    const organismIds: string[] = [];
    const provenanceUp: { fileId: string; relation: string; edgeId: string }[] = [];
    const provenanceDown: { fileId: string; relation: string; edgeId: string }[] = [];
    const linkEdges: EntityEdge[] = [];

    const SYSTEM_RELATIONS = new Set([
      'belongs_to',
      'from_organism',
      'links_to',
      'has_type',
      'targets',
    ]);
    for (const e of neighborhood) {
      if (e.sourceId === file.id && e.sourceType === 'file') {
        if (e.relation === 'belongs_to' && e.targetType === 'collection')
          collectionIds.push(e.targetId);
        if (e.relation === 'from_organism') organismIds.push(e.targetId);
        if (e.relation === 'links_to') linkEdges.push(e);
        if (e.targetType === 'file' && !SYSTEM_RELATIONS.has(e.relation)) {
          provenanceUp.push({ fileId: e.targetId, relation: e.relation, edgeId: e.id });
        }
      } else if (e.targetId === file.id && e.targetType === 'file') {
        if (!SYSTEM_RELATIONS.has(e.relation)) {
          provenanceDown.push({ fileId: e.sourceId, relation: e.relation, edgeId: e.id });
        }
      }
    }

    // Load related entities
    const collections = collectionIds.length
      ? await AppDataSource.getRepository(Collection).findByIds(collectionIds)
      : [];

    const uniqueOrgIds = [...new Set(organismIds)];
    const organisms = uniqueOrgIds.length
      ? await AppDataSource.getRepository(Organism).findByIds(uniqueOrgIds)
      : [];
    const orgMap = new Map(organisms.map((o) => [o.id, o]));

    // Load provenance files
    const allProvFileIds = [
      ...new Set([...provenanceUp.map((p) => p.fileId), ...provenanceDown.map((p) => p.fileId)]),
    ];
    const provFiles = allProvFileIds.length ? await repo.findByIds(allProvFileIds) : [];
    const provFileMap = new Map(provFiles.map((f) => [f.id, f]));

    res.json({
      id: file.id,
      filename: file.filename,
      s3Key: file.s3Key,
      sizeBytes: Number(file.sizeBytes),
      format: file.format,
      types: file.type,
      md5: file.md5,
      status: file.status,
      description: file.description,
      tags: file.tags,
      uploadedBy: file.uploadedBy,
      uploadedAt: file.uploadedAt,
      collections: collections.map((c) => ({ id: c.id, name: c.name, types: c.type })),
      organisms: organismIds.map((oId) => {
        const org = orgMap.get(oId);
        return { id: oId, displayName: org ? organismDisplay(org) : oId };
      }),
      provenance: {
        upstream: provenanceUp.map((p) => {
          const f = provFileMap.get(p.fileId);
          return {
            edgeId: p.edgeId,
            relation: p.relation,
            file: f ? { id: f.id, filename: f.filename, types: f.type, format: f.format } : null,
          };
        }),
        downstream: provenanceDown.map((p) => {
          const f = provFileMap.get(p.fileId);
          return {
            edgeId: p.edgeId,
            relation: p.relation,
            file: f ? { id: f.id, filename: f.filename, types: f.type, format: f.format } : null,
          };
        }),
      },
      links: linkEdges.map((e) => ({
        id: e.id,
        url: (e.metadata as any)?.url ?? '',
        service: (e.metadata as any)?.service ?? 'link',
        label: (e.metadata as any)?.label ?? null,
        createdAt: e.createdAt,
      })),
    });
  }),
);

// ─── Update file ────────────────────────────────────────────

router.put(
  '/:id',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const { types, format, description, tags } = req.body as Partial<{
      types: string[];
      format: string;
      description: string | null;
      tags: string[];
    }>;

    if (types !== undefined) file.type = types;
    if (format !== undefined) file.format = format;
    if (description !== undefined) file.description = description;
    if (tags !== undefined) file.tags = tags;
    await repo.save(file);

    res.json(file);
  }),
);

// ─── File organism link/unlink ──────────────────────────────

router.post(
  '/:id/organisms',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'file not found' });
      return;
    }

    const { organismId } = req.body as { organismId: string };
    if (!organismId) {
      res.status(400).json({ error: 'organismId required' });
      return;
    }

    const organism = await AppDataSource.getRepository(Organism).findOneBy({ id: organismId });
    if (!organism) {
      res.status(400).json({ error: 'organism not found' });
      return;
    }

    const userId = (res.locals.user as User)?.id ?? null;
    const edge = await edges.link(
      { type: 'file', id: file.id },
      { type: 'organism', id: organismId },
      'from_organism',
      null,
      userId,
    );

    // Return 201 if newly created, 200 if already existed
    res.status(edge.createdBy === userId ? 201 : 200).json({ ok: true });
  }),
);

router.delete(
  '/:id/organisms/:organismId',
  asyncWrap(async (req, res) => {
    await edges.unlink(
      { type: 'file', id: req.params.id },
      { type: 'organism', id: req.params.organismId },
      'from_organism',
    );
    res.json({ ok: true });
  }),
);

// ─── Add provenance edge ────────────────────────────────────

router.post(
  '/:id/provenance',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const { targetFileId, relation } = req.body as { targetFileId: string; relation: string };
    if (!targetFileId || !relation) {
      res.status(400).json({ error: 'targetFileId and relation required' });
      return;
    }

    const target = await repo.findOneBy({ id: targetFileId });
    if (!target) {
      res.status(404).json({ error: 'target file not found' });
      return;
    }

    const userId = (res.locals.user as User)?.id ?? null;
    const edge = await edges.link(
      { type: 'file', id: file.id },
      { type: 'file', id: targetFileId },
      relation as EdgeRelation,
      null,
      userId,
    );
    res.status(201).json(edge);
  }),
);

// ─── Remove provenance edge ────────────────────────────────

router.delete(
  '/:id/provenance/:edgeId',
  asyncWrap(async (req, res) => {
    const edgeRepo = AppDataSource.getRepository(EntityEdge);
    const edge = await edgeRepo.findOneBy({ id: req.params.edgeId });
    if (!edge) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    await edgeRepo.remove(edge);
    res.json({ ok: true });
  }),
);

// ─── Delete file ────────────────────────────────────────────

router.delete(
  '/:id',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    if (isLocal) {
      await deleteLocal(file.s3Key);
      if (file.parquetS3Key) await deleteLocal(file.parquetS3Key);
    } else {
      await deleteObject(file.s3Key);
      if (file.parquetS3Key) {
        await deleteObject(file.parquetS3Key).catch(() => {});
      }
    }
    await edges.cascadeDelete({ type: 'file', id: file.id });
    await repo.remove(file);
    res.json({ ok: true });
  }),
);

// ─── Download presigned URL ────────────────────────────────

router.get(
  '/:id/download',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    if (isLocal) {
      const url = `/api/storage/${file.s3Key}`;
      res.json({ url });
    } else {
      const url = await presignDownloadUrl(file.s3Key, file.filename);
      res.json({ url });
    }
  }),
);

export default router;
