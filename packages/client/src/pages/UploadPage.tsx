import { useState, useRef, useCallback, useId } from 'react';
import { useMultipartUpload } from '../hooks/useGenomicQueries';
import { useProjectsQuery } from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, formatBytes } from '../lib/formats';
import { Button, Badge, Text, Heading, Select, Input } from '../ui';

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
      className="relative border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors duration-fast"
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
        <Text variant="caption">
          FASTQ, BAM, CRAM, VCF, BED, GFF, FASTA, BigWig · No file size limit
        </Text>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".fastq,.fastq.gz,.fq,.fq.gz,.bam,.cram,.vcf,.vcf.gz,.bcf,.bed,.bed.gz,.gff,.gff3,.gtf,.fa,.fasta,.fa.gz,.fasta.gz,.sam,.bw,.bigwig,.bb,.bigbed"
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
  projectId: string;
  onRemove:  () => void;
  onProjectChange: (p: string) => void;
  projects: { id: string; name: string }[];
}

function QueueItem({ file, projectId, onRemove, onProjectChange, projects }: QueueItemProps) {
  const fmt  = detectFormat(file.name);
  const meta = FORMAT_META[fmt];

  return (
    <div className="flex items-center gap-2.5 p-2 bg-surface border border-border rounded-md">
      {/* Format pill */}
      <div className="font-mono text-micro px-1.5 py-0.5 rounded-sm shrink-0 font-bold"
        style={{ background: meta.bg, color: meta.color }}>
        {meta.label}
      </div>

      {/* Name + size */}
      <div className="flex-1 min-w-0">
        <div className="font-mono text-caption text-text truncate">{file.name}</div>
        <div className="text-micro text-text-dim">{formatBytes(file.size)} · {meta.description}</div>
      </div>

      {/* Project assign */}
      <Select
        variant="surface"
        size="sm"
        value={projectId}
        onChange={e => onProjectChange(e.target.value)}
        className="w-36 shrink-0"
      >
        <option value="">— project —</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>

      <Button intent="ghost" size="xs" onClick={onRemove}>×</Button>
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
        <span className="font-mono text-caption text-text flex-1 truncate">{filename}</span>
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
  const { data: projects } = useProjectsQuery();
  const { uploads, upload, clearDone } = useMultipartUpload();

  type QueueEntry = { file: File; projectId: string; tags: string; description: string };
  const [queue,      setQueue]      = useState<QueueEntry[]>([]);
  const [defaultPrj, setDefaultPrj] = useState('');
  const [uploading,  setUploading]  = useState(false);

  const addFiles = useCallback((files: File[]) => {
    setQueue(prev => [
      ...prev,
      ...files.map(f => ({ file: f, projectId: defaultPrj, tags: '', description: '' })),
    ]);
  }, [defaultPrj]);

  const removeFromQueue = (idx: number) =>
    setQueue(prev => prev.filter((_, i) => i !== idx));

  const setProjectForFile = (idx: number, projectId: string) =>
    setQueue(prev => prev.map((e, i) => i === idx ? { ...e, projectId } : e));

  const startUploads = async () => {
    const ready = queue.filter(e => e.projectId);
    if (!ready.length) return;
    setUploading(true);
    setQueue([]);
    await Promise.all(
      ready.map(e => upload(
        e.file, e.projectId,
        e.description || undefined,
        e.tags ? e.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      ))
    );
    setUploading(false);
  };

  const activeUploads  = [...uploads.values()].filter(u => u.status === 'uploading');
  const doneUploads    = [...uploads.values()].filter(u => u.status === 'done');
  const errorUploads   = [...uploads.values()].filter(u => u.status === 'error');

  return (
    <div className="flex flex-col gap-3 p-3 max-w-2xl mx-auto w-full">
      <div>
        <Heading level="heading">Upload Files</Heading>
        <Text variant="caption">Files are uploaded directly to S3 via multipart presigned URLs</Text>
      </div>

      <DropZone onFiles={addFiles} />

      {/* Queue */}
      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Text variant="overline">Queued ({queue.length})</Text>
            <div className="flex-1" />
            <span className="font-body text-caption text-text-secondary">Default project:</span>
            <Select
              variant="surface"
              size="sm"
              value={defaultPrj}
              onChange={e => setDefaultPrj(e.target.value)}
              className="w-44"
            >
              <option value="">— none —</option>
              {projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            {queue.map((e, i) => (
              <QueueItem
                key={i}
                file={e.file}
                projectId={e.projectId}
                projects={projects ?? []}
                onRemove={() => removeFromQueue(i)}
                onProjectChange={id => setProjectForFile(i, id)}
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
              disabled={!queue.some(e => e.projectId)}
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
