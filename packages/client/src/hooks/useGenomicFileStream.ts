import { useEffect, useRef } from 'react';
import {
  useStabilityOrchestrator,
  createRecordBatchStream,
  type ColumnSchema,
  type StabilityOrchestratorReturn,
} from 'concertina/core';
import type { GenomicFile } from './useGenomicQueries';

export const FILE_SCHEMA: ColumnSchema[] = [
  { name: 'id',               type: 'utf8',      maxContentChars: 36 },
  { name: 'filename',         type: 'utf8',      maxContentChars: 80 },
  { name: 'format',           type: 'utf8',      maxContentChars: 12 },
  { name: 'sizeBytes',        type: 'f64',       maxContentChars: 12 },
  { name: 'status',           type: 'utf8',      maxContentChars: 8  },
  { name: 'uploadedAt',       type: 'utf8',      maxContentChars: 24 },
  // Flat list columns — decoded on the worker; RowProxy.get() returns string[].
  { name: 'types',            type: 'list_utf8', maxContentChars: 60 },
  // Organisms split into parallel id/name lists so VirtualFileRow can
  // reconstruct { id, displayName } pairs without any main-thread JSON.parse.
  { name: 'organism_ids',     type: 'list_utf8', maxContentChars: 36 },
  { name: 'organism_names',   type: 'list_utf8', maxContentChars: 80 },
  // Collections: same pattern.
  { name: 'collection_ids',   type: 'list_utf8', maxContentChars: 36 },
  { name: 'collection_names', type: 'list_utf8', maxContentChars: 80 },
];

function fileToRow(f: GenomicFile): Record<string, unknown> {
  return {
    id:               f.id,
    filename:         f.filename,
    format:           f.format,
    sizeBytes:        f.sizeBytes,
    status:           f.status,
    uploadedAt:       f.uploadedAt,
    types:            f.types,
    organism_ids:     f.organisms.map(o => o.id),
    organism_names:   f.organisms.map(o => o.displayName),
    collection_ids:   f.collections.map(c => c.id),
    collection_names: f.collections.map(c => c.name ?? ''),
  };
}

// Rows per encoded batch. Each batch is ~150 KB on the wire (500 × ~300 B).
// Transferred to the worker and immediately relinquished — main-thread heap
// stays bounded regardless of total dataset size. The INGEST_ACK loop in
// useStabilityOrchestrator ensures only one batch is in flight at a time,
// so the IPC queue depth is O(1) even for 1M+ record datasets.
const INGEST_BATCH_SIZE = 500;

/**
 * Binary bridge: converts a GenomicFile array (from TanStack Query) into a
 * multi-batch columnar binary stream consumed by the Core Stability Engine.
 *
 * Re-ingests whenever the files array reference changes (query refetch or
 * filter change). The generator yields ≤INGEST_BATCH_SIZE rows at a time.
 */
export function useGenomicFileStream(
  files: GenomicFile[] | undefined,
): StabilityOrchestratorReturn {
  const orch = useStabilityOrchestrator({
    schema:        FILE_SCHEMA,
    rowHeightHint: 52,
    charWidthHint: 8,
  });

  const { ingest } = orch;
  const prevRef = useRef<GenomicFile[] | undefined>(undefined);

  useEffect(() => {
    if (!files || files === prevRef.current) return;
    prevRef.current = files;

    const snapshot = files;
    async function* batchIt() {
      for (let i = 0; i < snapshot.length; i += INGEST_BATCH_SIZE) {
        yield snapshot.slice(i, i + INGEST_BATCH_SIZE).map(fileToRow);
      }
    }

    return ingest(createRecordBatchStream(FILE_SCHEMA, batchIt()));
  }, [files, ingest]);

  return orch;
}
