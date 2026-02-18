import { useState, useRef, useCallback, useMemo } from 'react';
import { useMultipartUpload, useCollectionsQuery, useTechniquesQuery } from '../hooks/useGenomicQueries';
import type { Collection, Technique } from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, formatBytes } from '../lib/formats';
import { Button, Text, Heading, Input } from '../ui';
import { CollectionPicker, OrganismPicker, FileKindPicker } from '../ui';

// ── Drop zone ─────────────────────────────────────────────

interface DropZoneProps {
  onFiles: (files: File[]) => void;
}

function DropZone({ onFiles }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }, [onFiles]);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className="relative border-2 border-dashed rounded-lg p-4 md:p-8 flex flex-col items-center gap-2 md:gap-3 cursor-pointer transition-colors duration-fast"
      style={{
        borderColor: dragging ? 'var(--color-accent)' : 'var(--color-border)',
        background:  dragging ? 'oklch(0.70 0.18 168 / 0.06)' : 'var(--color-surface)',
      }}
    >
      {dragging && (
        <div className="absolute inset-0 rounded-lg pointer-events-none"
          style={{ boxShadow: '0 0 0 2px var(--color-accent) inset' }} />
      )}

      {/* Icon */}
      <div className="flex items-center justify-center w-12 h-12 rounded-full"
        style={{ background: 'oklch(0.70 0.18 168 / 0.12)' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          style={{ color: 'var(--color-accent)' }}>
          <path d="M12 4v12m0-12L8 8m4-4l4 4" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="text-center">
        <Text variant="secondary">
          Drop genomic files here, or <span style={{ color: 'var(--color-accent)' }}>browse</span>
        </Text>
        <Text variant="caption" as="div" className="hidden sm:block">
          FASTQ, BAM, CRAM, VCF, BED, GFF, FASTA, H5AD, Cool, Parquet &amp; more · No file size limit
        </Text>
        <Text variant="caption" as="div" className="sm:hidden">
          Any genomic file format · No limit
        </Text>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

// ── File queue item ───────────────────────────────────────

interface QueueItemProps {
  file:      File;
  organismId: string;
  collectionId: string;
  kind: string;
  description: string;
  tags: string;
  onRemove:  () => void;
  onChange: (patch: Partial<{ organismId: string; collectionId: string; kind: string; description: string; tags: string }>) => void;
}

function QueueItem({ file, organismId, collectionId, kind, description, tags, onRemove, onChange }: QueueItemProps) {
  const fmt  = detectFormat(file.name);
  const meta = FORMAT_META[fmt];

  return (
    <div className="flex flex-col gap-2 p-2.5 bg-surface border border-border rounded-md">
      {/* Row 1: identity */}
      <div className="flex items-center gap-2">
        <div className="font-mono text-micro px-1.5 py-0.5 rounded-sm shrink-0 font-bold"
          style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-caption text-text truncate">{file.name}</div>
          <div className="text-micro text-text-dim">{formatBytes(file.size)} · {meta.label}</div>
        </div>
        <Button intent="ghost" size="sm" onClick={onRemove}>×</Button>
      </div>

      {/* Row 2: assignment selects — stack on mobile */}
      <div className="flex flex-col sm:flex-row gap-2">
        <OrganismPicker
          value={organismId}
          onValueChange={v => onChange({ organismId: v })}
          placeholder="Organism"
          variant="surface"
          size="sm"
          className="w-full sm:w-40"
        />
        <CollectionPicker
          value={collectionId}
          onValueChange={v => onChange({ collectionId: v })}
          placeholder="Collection"
          variant="surface"
          size="sm"
          className="w-full sm:w-40"
        />
        <FileKindPicker
          value={kind}
          onValueChange={v => onChange({ kind: v })}
          placeholder="Kind"
          variant="surface"
          size="sm"
          className="w-full sm:w-32"
        />
      </div>

      {/* Row 3: description + tags — stack on mobile */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          variant="surface" size="sm"
          placeholder="Description (optional)"
          value={description}
          onChange={e => onChange({ description: e.target.value })}
          className="flex-1"
        />
        <Input
          variant="surface" size="sm"
          placeholder="Tags (comma-separated)"
          value={tags}
          onChange={e => onChange({ tags: e.target.value })}
          className="w-full sm:w-48"
        />
      </div>
    </div>
  );
}

// ── Upload progress bar ───────────────────────────────────

interface ProgressBarProps {
  filename: string;
  loaded:   number;
  total:    number;
  status:   'uploading' | 'done' | 'error';
  error?:   string;
}

function ProgressBar({ filename, loaded, total, status, error }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const fmt = detectFormat(filename);
  const meta = FORMAT_META[fmt];

  return (
    <div className="flex flex-col gap-1 p-2 bg-surface border border-border rounded-md">
      <div className="flex items-center gap-2">
        <div className="font-mono text-micro px-1 py-px rounded-sm"
          style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </div>
        <span className="font-mono text-caption text-text flex-1 truncate min-w-0">{filename}</span>
        <span className="font-mono text-micro text-text-dim tabular-nums shrink-0">
          {status === 'done' ? '✓' : status === 'error' ? '✗' : `${pct}%`}
        </span>
      </div>

      {/* Track */}
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-normal"
          style={{
            width: `${pct}%`,
            background: status === 'done'  ? 'var(--color-green)'
                      : status === 'error' ? 'var(--color-red)'
                      : 'var(--color-accent)',
          }}
        >
          {status === 'uploading' && <div className="h-full progress-stripe" />}
        </div>
      </div>

      {status === 'uploading' && (
        <Text variant="caption">{formatBytes(loaded)} / {formatBytes(total)}</Text>
      )}
      {status === 'error' && (
        <Text variant="error">{error}</Text>
      )}
    </div>
  );
}

// ── UploadPage ────────────────────────────────────────────

export default function UploadPage() {
  const { data: collections } = useCollectionsQuery();
  const { data: techniques } = useTechniquesQuery();
  const { uploads, upload, clearDone } = useMultipartUpload();

  // Build lookup: collectionId → defaultTags from its technique
  const suggestedTagsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!collections || !techniques) return map;
    const techMap = new Map<string, Technique>();
    for (const t of techniques) techMap.set(t.id, t);
    for (const col of collections) {
      if (col.techniqueId) {
        const t = techMap.get(col.techniqueId);
        if (t?.defaultTags?.length) map.set(col.id, t.defaultTags);
      }
    }
    return map;
  }, [collections, techniques]);

  type QueueEntry = { file: File; organismId: string; collectionId: string; kind: string; tags: string; description: string };
  const [queue,      setQueue]      = useState<QueueEntry[]>([]);
  const [defaultOrg, setDefaultOrg] = useState('');
  const [defaultCol, setDefaultCol] = useState('');
  const [defaultKind, setDefaultKind] = useState('raw');
  const [uploading,  setUploading]  = useState(false);

  const addFiles = useCallback((files: File[]) => {
    setQueue(prev => [
      ...prev,
      ...files.map(f => ({ file: f, organismId: defaultOrg, collectionId: defaultCol, kind: defaultKind, tags: '', description: '' })),
    ]);
  }, [defaultOrg, defaultCol, defaultKind]);

  // Propagate default changes to queue items that still have the old/empty value
  const handleDefaultOrg = (id: string) => {
    setDefaultOrg(id);
    setQueue(prev => prev.map(e => (!e.organismId ? { ...e, organismId: id } : e)));
  };
  const handleDefaultCol = (id: string) => {
    setDefaultCol(id);
    setQueue(prev => prev.map(e => {
      if (e.collectionId) return e;
      const updated = { ...e, collectionId: id };
      if (!e.tags) {
        const suggested = suggestedTagsMap.get(id);
        if (suggested?.length) updated.tags = suggested.join(', ');
      }
      return updated;
    }));
  };
  const handleDefaultKind = (k: string) => {
    setDefaultKind(k);
    setQueue(prev => prev.map(e => (e.kind === 'raw' || !e.kind ? { ...e, kind: k } : e)));
  };

  const removeFromQueue = (idx: number) =>
    setQueue(prev => prev.filter((_, i) => i !== idx));

  const updateQueueItem = (idx: number, patch: Partial<QueueEntry>) =>
    setQueue(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const updated = { ...e, ...patch };
      // Auto-suggest tags when collection changes and tags are empty
      if (patch.collectionId && patch.collectionId !== e.collectionId && !e.tags) {
        const suggested = suggestedTagsMap.get(patch.collectionId);
        if (suggested?.length) updated.tags = suggested.join(', ');
      }
      return updated;
    }));

  const startUploads = async () => {
    if (!queue.length) return;
    setUploading(true);
    setQueue([]);
    await Promise.all(
      queue.map(e => upload(e.file, {
        description: e.description || undefined,
        tags: e.tags ? e.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
        organismId: e.organismId || undefined,
        collectionId: e.collectionId || undefined,
        kind: e.kind || undefined,
      }))
    );
    setUploading(false);
  };

  const activeUploads  = [...uploads.values()].filter(u => u.status === 'uploading');
  const doneUploads    = [...uploads.values()].filter(u => u.status === 'done');
  const errorUploads   = [...uploads.values()].filter(u => u.status === 'error');

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 max-w-3xl mx-auto w-full">
      <div>
        <Heading level="heading">Upload Files</Heading>
        <Text variant="caption">Files are uploaded directly to S3 via multipart presigned URLs</Text>
      </div>

      <DropZone onFiles={addFiles} />

      {/* Queue */}
      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Queue header — batch defaults */}
          <div className="flex flex-col gap-2">
            <Text variant="overline">Queued ({queue.length})</Text>
            <div className="flex flex-col sm:flex-row gap-2">
              <span className="font-body text-micro text-text-dim shrink-0 self-center">Defaults:</span>
              <OrganismPicker
                value={defaultOrg}
                onValueChange={handleDefaultOrg}
                placeholder="Organism"
                variant="surface"
                size="sm"
                className="w-full sm:w-40"
              />
              <CollectionPicker
                value={defaultCol}
                onValueChange={handleDefaultCol}
                placeholder="Collection"
                variant="surface"
                size="sm"
                className="w-full sm:w-40"
              />
              <FileKindPicker
                value={defaultKind}
                onValueChange={handleDefaultKind}
                placeholder="Kind"
                variant="surface"
                size="sm"
                className="w-full sm:w-32"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            {queue.map((e, i) => (
              <QueueItem
                key={i}
                file={e.file}
                organismId={e.organismId}
                collectionId={e.collectionId}
                kind={e.kind}
                description={e.description}
                tags={e.tags}
                onRemove={() => removeFromQueue(i)}
                onChange={patch => updateQueueItem(i, patch)}
              />
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <Button intent="ghost" size="md" onClick={() => setQueue([])}>Clear all</Button>
            <Button
              intent="primary"
              size="md"
              pending={uploading}
              onClick={startUploads}
              disabled={queue.length === 0}
            >
              Upload {queue.length} file{queue.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}

      {/* In-progress */}
      {activeUploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Text variant="overline">Uploading</Text>
          {activeUploads.map(u => <ProgressBar key={u.fileId} {...u} />)}
        </div>
      )}

      {/* Errors */}
      {errorUploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Text variant="overline">Failed</Text>
          {errorUploads.map(u => <ProgressBar key={u.fileId} {...u} />)}
        </div>
      )}

      {/* Done */}
      {doneUploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Text variant="overline">Completed ({doneUploads.length})</Text>
            <Button intent="bare" size="xs" onClick={clearDone} className="text-text-dim hover:text-text">
              clear
            </Button>
          </div>
          {doneUploads.map(u => <ProgressBar key={u.fileId} {...u} />)}
        </div>
      )}
    </div>
  );
}
