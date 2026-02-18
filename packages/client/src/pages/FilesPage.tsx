import type { GenomicFile } from "../hooks/useGenomicQueries";
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFilesQuery, useDeleteFileMutation, usePresignedUrl } from '../hooks/useGenomicQueries';
import { useConfirm } from '../hooks/useConfirm';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card } from '../ui';
import { ProjectPicker, ExperimentPicker, SamplePicker } from '../ui';

// ── Format icon ──────────────────────────────────────────

function FormatIcon({ filename, size = 32 }: { filename: string; size?: number }) {
  const fmt   = detectFormat(filename);
  const meta  = FORMAT_META[fmt];
  return (
    <div
      className="flex items-center justify-center rounded-sm shrink-0 font-mono font-bold"
      style={{
        width: size, height: size,
        background: meta.bg,
        color: meta.color,
        fontSize: size * 0.28,
        letterSpacing: '-0.02em',
      }}
    >
      {meta.label}
    </div>
  );
}

// ── Mobile file card ────────────────────────────────────

interface FileCardProps {
  file: GenomicFile;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
  selected: boolean;
  onSelect: (id: string, sel: boolean) => void;
}

function FileCard({ file, onDelete, onDownload, selected, onSelect }: FileCardProps) {
  const fmt  = detectFormat(file.filename);
  const meta = FORMAT_META[fmt];

  return (
    <Card
      className="p-2.5 flex flex-col gap-1.5"
      style={{ background: selected ? 'var(--color-surface-2)' : undefined }}
    >
      {/* Top row: checkbox + format + filename */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(file.id, e.target.checked)}
          className="accent-accent cursor-pointer shrink-0"
        />
        <span className="font-mono text-micro px-1 py-px rounded-sm shrink-0 font-bold"
          style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
        <span className="font-mono text-caption text-text truncate flex-1 min-w-0">
          {file.filename}
        </span>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-2 flex-wrap pl-5.5">
        <Text variant="caption">{file.projectName}</Text>
        <Text variant="caption">{formatBytes(file.sizeBytes)}</Text>
        {file.status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
        {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
        {file.status === 'error'   && <Badge variant="status" color="red">error</Badge>}
        <Text variant="caption">{formatRelativeTime(file.uploadedAt)}</Text>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 pl-5.5">
        <Button intent="ghost" size="sm" onClick={() => onDownload(file.id)}>Download</Button>
        <Button intent="danger" size="sm" onClick={() => onDelete(file.id)}>Delete</Button>
      </div>
    </Card>
  );
}

// ── File row (desktop table) ────────────────────────────

interface FileRowProps {
  file: GenomicFile;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
  selected: boolean;
  onSelect: (id: string, sel: boolean) => void;
}

function FileRow({ file, onDelete, onDownload, selected, onSelect }: FileRowProps) {
  const fmt  = detectFormat(file.filename);
  const meta = FORMAT_META[fmt];

  return (
    <tr
      className="border-b border-border-subtle transition-colors duration-fast hover:bg-surface group"
      style={{ background: selected ? 'var(--color-surface-2)' : undefined }}
    >
      {/* Checkbox */}
      <td className="pl-3 pr-1 py-1.5 w-6">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(file.id, e.target.checked)}
          className="accent-accent cursor-pointer"
        />
      </td>

      {/* Icon + name */}
      <td className="py-1.5 pr-3">
        <div className="flex items-center gap-2">
          <FormatIcon filename={file.filename} size={28} />
          <div className="min-w-0">
            <div className="font-mono text-caption text-text truncate max-w-xs">{file.filename}</div>
            {file.description && (
              <div className="text-micro text-text-dim truncate">{file.description}</div>
            )}
          </div>
        </div>
      </td>

      {/* Project */}
      <td className="py-1.5 pr-3 text-caption text-text-secondary whitespace-nowrap">
        {file.projectName}
      </td>

      {/* Organism */}
      <td className="py-1.5 pr-3 text-caption text-text-secondary italic whitespace-nowrap">
        {file.organismDisplay ?? '—'}
      </td>

      {/* Experiment */}
      <td className="py-1.5 pr-3 text-caption text-text-secondary whitespace-nowrap">
        {file.experimentName ?? '—'}
      </td>

      {/* Format */}
      <td className="py-1.5 pr-3 whitespace-nowrap">
        <span className="font-mono text-micro px-1 py-px rounded-sm"
          style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </td>

      {/* Size */}
      <td className="py-1.5 pr-3 text-caption font-mono text-text-secondary tabular-nums whitespace-nowrap">
        {formatBytes(file.sizeBytes)}
      </td>

      {/* Status */}
      <td className="py-1.5 pr-3">
        {file.status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
        {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
        {file.status === 'error'   && <Badge variant="status" color="red">error</Badge>}
      </td>

      {/* Uploaded */}
      <td className="py-1.5 pr-3 text-caption text-text-dim whitespace-nowrap">
        {formatRelativeTime(file.uploadedAt)}
      </td>

      {/* Tags */}
      <td className="py-1.5 pr-3">
        <div className="flex gap-0.5 flex-wrap">
          {file.tags.slice(0, 3).map(t => (
            <Badge key={t} variant="count" color="dim">{t}</Badge>
          ))}
        </div>
      </td>

      {/* Actions */}
      <td className="py-1.5 pr-3">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-fast">
          <Button intent="ghost" size="xs" onClick={() => onDownload(file.id)}>↓</Button>
          <Button intent="danger" size="xs" onClick={() => onDelete(file.id)}>×</Button>
        </div>
      </td>
    </tr>
  );
}

// ── Skeleton row ─────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(11)].map((_, i) => (
        <td key={i} className="py-2 pr-3">
          <div className="skeleton h-4 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── Skeleton card (mobile) ──────────────────────────────

function SkeletonCard() {
  return (
    <Card className="p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="skeleton h-4 w-4 rounded-sm" />
        <div className="skeleton h-3 rounded-sm" style={{ width: '40px' }} />
        <div className="skeleton h-3 rounded-sm flex-1" />
      </div>
      <div className="flex gap-2 pl-5.5">
        <div className="skeleton h-3 rounded-sm w-16" />
        <div className="skeleton h-3 rounded-sm w-12" />
        <div className="skeleton h-3 rounded-sm w-10" />
      </div>
    </Card>
  );
}

// ── FilesPage ─────────────────────────────────────────────

const FORMAT_FILTERS = ['all', 'fastq', 'bam', 'cram', 'vcf', 'bed', 'fasta', 'other'] as const;

export default function FilesPage() {
  const [searchParams] = useSearchParams();
  const [filterProjectId, setFilterProjectId] = useState(searchParams.get('project') ?? '');
  const [filterExperimentId, setFilterExperimentId] = useState('');
  const [filterSampleId, setFilterSampleId] = useState('');

  const { data, isLoading, refetch } = useFilesQuery({
    projectId: filterProjectId || undefined,
    experimentId: filterExperimentId || undefined,
    sampleId: filterSampleId || undefined,
  });
  const { deleteFile, pending: deletePending } = useDeleteFileMutation(refetch);
  const { getUrl, pending: urlPending } = usePresignedUrl();
  const { confirm, dialog } = useConfirm();

  const [search,     setSearch]     = useState('');
  const [fmtFilter,  setFmtFilter]  = useState<string>('all');
  const [selected,   setSelected]   = useState<Set<string>>(new Set());

  // Cascading clears
  const handleProjectChange = (id: string) => {
    setFilterProjectId(id);
    setFilterExperimentId('');
    setFilterSampleId('');
  };
  const handleExperimentChange = (id: string) => {
    setFilterExperimentId(id);
    setFilterSampleId('');
  };

  const files = useMemo(() => {
    if (!data) return [];
    return data.filter(f => {
      const q = search.toLowerCase();
      const matchSearch = !search || f.filename.toLowerCase().includes(q)
        || f.projectName.toLowerCase().includes(q)
        || (f.organismDisplay?.toLowerCase().includes(q) ?? false)
        || (f.experimentName?.toLowerCase().includes(q) ?? false);
      const matchFmt = fmtFilter === 'all' || detectFormat(f.filename) === fmtFilter;
      return matchSearch && matchFmt;
    });
  }, [data, search, fmtFilter]);

  const allSelected   = files.length > 0 && files.every(f => selected.has(f.id));
  const toggleAll     = () => setSelected(allSelected ? new Set() : new Set(files.map(f => f.id)));
  const toggleOne     = (id: string, sel: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      sel ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const handleDownload = async (id: string) => {
    const url = await getUrl(id);
    window.open(url, '_blank');
  };

  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: 'Delete files',
      message: `Are you sure you want to delete ${selected.size} file(s)? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    for (const id of selected) await deleteFile(id);
    setSelected(new Set());
  };

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {dialog}
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <Heading level="heading">Files</Heading>
          <Text variant="caption">
            {data ? `${data.length.toLocaleString()} files` : 'Loading\u2026'}
          </Text>
        </div>

        {selected.size > 0 && (
          <Button intent="danger" size="sm" pending={deletePending} onClick={handleBulkDelete}>
            Delete {selected.size}
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Input
          variant="surface"
          size="md"
          placeholder="Search files or projects\u2026"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full md:w-64"
        />

        <ProjectPicker
          value={filterProjectId}
          onValueChange={handleProjectChange}
          placeholder="All projects"
          variant="surface"
          size="md"
          className="w-full sm:w-44"
        />

        {filterProjectId && (
          <ExperimentPicker
            value={filterExperimentId}
            onValueChange={handleExperimentChange}
            projectId={filterProjectId}
            placeholder="All experiments"
            variant="surface"
            size="md"
            className="w-full sm:w-44"
          />
        )}

        {filterExperimentId && (
          <SamplePicker
            value={filterSampleId}
            onValueChange={setFilterSampleId}
            experimentId={filterExperimentId}
            placeholder="All samples"
            variant="surface"
            size="md"
            className="w-full sm:w-44"
          />
        )}

        <div className="flex gap-1 flex-wrap">
          {FORMAT_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFmtFilter(f)}
              className="font-body text-micro px-1.5 py-1 md:py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer min-h-5.5 md:min-h-0"
              style={{
                background: fmtFilter === f ? 'var(--color-accent)' : 'var(--color-surface-2)',
                color:      fmtFilter === f ? 'var(--color-bg)'     : 'var(--color-text-secondary)',
                borderColor: fmtFilter === f ? 'transparent'        : 'var(--color-border)',
              }}
            >
              {f === 'all' ? 'All' : FORMAT_META[f as keyof typeof FORMAT_META]?.label ?? f}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop table — hidden below md */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface">
        <table className="w-full border-collapse text-left min-w-2xl">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="border-b border-border">
              <th className="pl-3 pr-1 py-1.5 w-6">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-accent cursor-pointer"
                />
              </th>
              {['File', 'Project', 'Organism', 'Experiment', 'Format', 'Size', 'Status', 'Uploaded', 'Tags', ''].map(h => (
                <th key={h} className="py-1.5 pr-3 font-body text-micro uppercase tracking-overline text-text-dim font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
              : files.length === 0
                ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-text-dim font-body text-body">
                      {search || fmtFilter !== 'all' || filterProjectId ? 'No files match your filters.' : 'No files yet. Upload some to get started.'}
                    </td>
                  </tr>
                )
                : files.map(f => (
                  <FileRow
                    key={f.id}
                    file={f}
                    selected={selected.has(f.id)}
                    onSelect={toggleOne}
                    onDelete={deleteFile}
                    onDownload={handleDownload}
                  />
                ))
            }
          </tbody>
        </table>
      </div>

      {/* Mobile cards — visible below md */}
      <div className="flex flex-col gap-1.5 md:hidden flex-1 overflow-auto min-h-0">
        {/* Select all row */}
        {files.length > 0 && (
          <label className="flex items-center gap-2 px-1 py-0.5">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-accent cursor-pointer"
            />
            <Text variant="caption">Select all</Text>
          </label>
        )}

        {isLoading
          ? [...Array(4)].map((_, i) => <SkeletonCard key={i} />)
          : files.length === 0
            ? (
              <div className="py-8 text-center text-text-dim font-body text-body">
                {search || fmtFilter !== 'all' || filterProjectId ? 'No files match your filters.' : 'No files yet. Upload some to get started.'}
              </div>
            )
            : files.map(f => (
              <FileCard
                key={f.id}
                file={f}
                selected={selected.has(f.id)}
                onSelect={toggleOne}
                onDelete={deleteFile}
                onDownload={handleDownload}
              />
            ))
        }
      </div>
    </div>
  );
}
