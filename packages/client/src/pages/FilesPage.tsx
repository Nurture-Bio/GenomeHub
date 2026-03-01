import type { GenomicFile } from '../hooks/useGenomicQueries';
import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import {
  useFilesQuery, useDeleteFileMutation, useUpdateFileMutation,
  usePresignedUrl, useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddFileOrganism, useRemoveFileOrganism,
} from '../hooks/useGenomicQueries';
import { useConfirm } from '../hooks/useConfirm';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card, ChipEditor, HashPill, FilterChip, iconAction } from '../ui';
import LoadingCrossfade from '../components/LoadingCrossfade';
import { CollectionPicker, OrganismPicker, FileTypePicker } from '../ui';

// ── Grid layout constants ─────────────────────────────────────────────────────

const GRID_COLS = '28px 1fr 80px 112px 144px 112px 176px 32px';
const GRID_GAP  = '0 12px';

// ── Format icon ──────────────────────────────────────────────────────────────

function FormatIcon({ filename, format, className }: { filename: string; format?: string; className?: string }) {
  const fmt  = format ?? detectFormat(filename);
  const meta = FORMAT_META[fmt] ?? FORMAT_META['other'];
  return (
    <div
      className={cx('format-icon shrink-0 font-mono font-bold', className)}
      style={{ background: meta.bg, color: meta.color }}
    >
      {meta.label}
    </div>
  );
}

// ── Desktop skeleton grid row ─────────────────────────────────────────────────

function SkeletonGridRow() {
  return (
    <div
      className="grid items-center border-b border-line tbl-row"
      style={{ gridTemplateColumns: GRID_COLS, gap: GRID_GAP }}
    >
      <div className="skeleton skel-check" />
      <div className="flex items-center gap-2 min-w-0">
        <div className="skeleton skel-format-icon shrink-0" />
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="skeleton h-[1lh] w-3/4" />
          <div className="skeleton h-[1lh] w-1/4" />
        </div>
      </div>
      <div className="skeleton h-[1lh] w-12 rounded-full" />
      <div className="skeleton h-[1lh] w-20" />
      <div className="skeleton h-[1lh] w-16 rounded-full" />
      <div className="skeleton h-[1lh] w-12 rounded-full" />
      <div className="skeleton h-[1lh] w-16 rounded-full" />
      <div />
    </div>
  );
}

// ── File grid row ─────────────────────────────────────────────────────────────

type OrgItem  = { id: string; displayName: string };
type ColItem  = { id: string; name: string | null };

interface FileRowProps {
  id:          string;
  index?:      number;
  filename:    string;
  format:      string;
  sizeBytes:   number;
  status:      string;
  uploadedAt:  string;
  types:       string[];
  organisms:   OrgItem[];
  collections: ColItem[];
  selected:    boolean;
  onSelect:             (id: string, sel: boolean) => void;
  onDownload:           (id: string) => void;
  onUpdateTypes:        (id: string, types: string[]) => void;
  onAddOrganism:        (fileId: string, orgId: string) => void;
  onRemoveOrganism:     (fileId: string, orgId: string) => void;
  onAddToCollection:    (collectionId: string, fileIds: string[]) => Promise<void>;
  onRemoveFromCollection: (collectionId: string, fileIds: string[]) => Promise<void>;
}

function FileRow({
  id, index, filename, format, sizeBytes, status, uploadedAt,
  types, organisms, collections,
  selected, onSelect, onDownload,
  onUpdateTypes, onAddOrganism, onRemoveOrganism,
  onAddToCollection, onRemoveFromCollection,
}: FileRowProps) {
  return (
    <div
      className="grid items-center border-b border-line transition-colors duration-fast hover:bg-base tbl-row stagger-item"
      style={{
        gridTemplateColumns: GRID_COLS,
        gap: GRID_GAP,
        background: selected ? 'var(--color-raised)' : undefined,
        '--i': Math.min(index ?? 0, 15),
      } as React.CSSProperties}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={e => onSelect(id, e.target.checked)}
        className="accent-cyan cursor-pointer"
      />

      {/* File: icon + name + size */}
      <div className="flex items-start gap-2 min-w-0">
        <FormatIcon filename={filename} format={format} />
        <div className="min-w-0 flex-1">
          <Link to={`/files/${id}`} className="no-underline">
            <span className="font-mono text-sm truncate block hover:text-cyan transition-colors duration-fast tabular-nums">
              {filename}
            </span>
          </Link>
          <span className="text-sm" style={{ color: 'var(--color-fg-2)' }}>
            {formatBytes(sizeBytes)}
          </span>
        </div>
      </div>

      {/* Status */}
      <div>
        {status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
        {status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
        {status === 'error'   && <Badge variant="status" color="red">error</Badge>}
      </div>

      {/* Time */}
      <span className="text-sm whitespace-nowrap" style={{ color: 'var(--color-fg-2)' }}>
        {formatRelativeTime(uploadedAt)}
      </span>

      {/* Organism */}
      <ChipEditor
        items={organisms.map(o => ({ id: o.id, label: o.displayName }))}
        onAdd={orgId => onAddOrganism(id, orgId)}
        onRemove={orgId => onRemoveOrganism(id, orgId)}
        renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-32" />}
        maxVisible={2}
      />

      {/* Type */}
      <ChipEditor
        items={types.map(t => ({ id: t, label: t }))}
        onAdd={t => onUpdateTypes(id, [...types, t])}
        onRemove={t => onUpdateTypes(id, types.filter(x => x !== t))}
        renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
        maxVisible={2}
      />

      {/* Collections */}
      <ChipEditor
        items={collections.map(c => ({ id: c.id, label: c.name ?? '' }))}
        onAdd={colId => onAddToCollection(colId, [id])}
        onRemove={colId => onRemoveFromCollection(colId, [id])}
        renderPicker={p => <CollectionPicker {...p} variant="surface" size="sm" className="w-32" />}
        renderLabel={item => (
          <Link to={`/collections/${item.id}`} className="no-underline hover:opacity-80">
            {item.label}
          </Link>
        )}
        maxVisible={2}
      />

      {/* Download */}
      <button
        onClick={() => onDownload(id)}
        className={iconAction({ color: 'dim', reveal: true })}
        title="Download"
      >
        ↓
      </button>
    </div>
  );
}

// ── Mobile file card ──────────────────────────────────────────────────────────

interface FileCardProps {
  file: GenomicFile;
  loading?: boolean;
  onDownload: (id: string) => void;
  selected: boolean;
  onSelect: (id: string, sel: boolean) => void;
}

function FileCard({ file, loading = false, onDownload, selected, onSelect }: FileCardProps) {
  const fmt  = file.format;
  const meta = FORMAT_META[fmt] ?? FORMAT_META['other'];

  return (
    <Card
      className="p-2.5 flex flex-col gap-1.5"
      style={{ background: selected ? 'var(--color-raised)' : undefined }}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(file.id, e.target.checked)}
          className="accent-cyan cursor-pointer shrink-0"
          disabled={loading}
        />
        {loading
          ? <div className="skeleton skel-format-icon shrink-0" />
          : <HashPill label={meta.label} colorKey={fmt} />
        }
        {loading
          ? <div className="skeleton h-[1lh] flex-1" />
          : <Link to={`/files/${file.id}`} className="no-underline flex-1 min-w-0">
              <span className="font-mono text-sm truncate block hover:text-cyan transition-colors duration-fast tabular-nums">{file.filename}</span>
            </Link>
        }
      </div>

      {!loading && (
        <>
          <div className="flex items-center gap-2 flex-wrap pl-5.5">
            <Text variant="dim">{formatBytes(file.sizeBytes)}</Text>
            {file.types.map(t => <HashPill key={t} label={t} />)}
            {file.organisms.map(o => <HashPill key={o.id} label={o.displayName} />)}
            {file.status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
            {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
            {file.status === 'error'   && <Badge variant="status" color="red">error</Badge>}
            <Text variant="dim">{formatRelativeTime(file.uploadedAt)}</Text>
          </div>
          <div className="flex gap-1.5 pl-5.5">
            <Button intent="ghost" size="sm" onClick={() => onDownload(file.id)}>Download</Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Stub files for loading skeleton ──────────────────────────────────────────

const STUB_FILES: GenomicFile[] = [
  'sequence_data_001.fastq.gz',
  'genome_assembly.fa.gz',
  'gene_annotations.gff3',
  'variants_filtered.vcf.gz',
  'methylation_calls.bedGraph',
  'rna_counts_matrix.tsv',
  'aligned_reads.bam',
  'peak_calls.narrowPeak',
].map((filename, i) => ({
  id: `__stub_${i}`, filename, s3Key: '',
  sizeBytes: 8_600_000, format: detectFormat(filename),
  types: [], md5: null, status: 'ready' as const,
  uploadedAt: new Date(0).toISOString(),
  description: null, tags: [], organisms: [], collections: [], uploadedBy: null,
}));

// ── FilesPage ─────────────────────────────────────────────────────────────────

export default function FilesPage() {
  const [filterCollectionId, setFilterCollectionId] = useState('');
  const [filterType, setFilterType] = useState('');

  const { data, isLoading, isError } = useFilesQuery({
    collectionId: filterCollectionId || undefined,
    type: filterType || undefined,
  });
  const { deleteFile, pending: deletePending } = useDeleteFileMutation();
  const { updateFile } = useUpdateFileMutation();
  const { addFiles } = useAddFilesToCollection();
  const { removeFiles } = useRemoveFilesFromCollection();
  const { addFileOrganism } = useAddFileOrganism();
  const { removeFileOrganism } = useRemoveFileOrganism();
  const { getUrl } = usePresignedUrl();
  const { confirm } = useConfirm();

  // Derive filter items from actual data
  const formatItems = useMemo(() => {
    if (!data) return [];
    const fmts = new Set(data.map(f => f.format));
    return Array.from(fmts).sort().map(f => ({ id: f, label: FORMAT_META[f]?.label ?? f }));
  }, [data]);

  const typeItems = useMemo(() => {
    if (!data) return [];
    const types = new Set(data.flatMap(f => f.types).filter(Boolean));
    return Array.from(types).sort().map(t => ({ id: t, label: t }));
  }, [data]);

  const colItems = useMemo(() => {
    if (!data) return [];
    const cols = new Map<string, string>();
    data.forEach(f => f.collections.forEach(c => { if (c.name) cols.set(c.id, c.name); }));
    return Array.from(cols.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ id, label }));
  }, [data]);

  const orgItems = useMemo(() => {
    if (!data) return [];
    const orgs = new Map<string, string>();
    data.forEach(f => f.organisms.forEach(o => orgs.set(o.id, o.displayName)));
    return Array.from(orgs.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ id, label }));
  }, [data]);

  const [search,     setSearch]     = useState('');
  const [fmtFilter,  setFmtFilter]  = useState('');
  const [orgFilter,  setOrgFilter]  = useState('');
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [addToColId, setAddToColId] = useState<string | null>(null);

  const files = useMemo(() => {
    if (!data) return [];
    return data.filter(f => {
      const q = search.toLowerCase();
      const matchSearch = !search || f.filename.toLowerCase().includes(q)
        || f.organisms.some(o => o.displayName.toLowerCase().includes(q))
        || f.collections.some(c => c.name?.toLowerCase().includes(q))
        || f.tags.some(t => t.toLowerCase().includes(q));
      const matchFmt = !fmtFilter || f.format === fmtFilter;
      const matchOrg = !orgFilter || f.organisms.some(o => o.id === orgFilter);
      return matchSearch && matchFmt && matchOrg;
    });
  }, [data, search, fmtFilter, orgFilter]);

  const allSelected = files.length > 0 && files.every(f => selected.has(f.id));
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(files.map(f => f.id)));
  const toggleOne   = useCallback((id: string, sel: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      sel ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const handleDownload = useCallback(async (id: string) => {
    const url = await getUrl(id);
    window.open(url, '_blank');
  }, [getUrl]);

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

  const handleBulkAddToCollection = async (collectionId: string) => {
    if (!collectionId || selected.size === 0) return;
    await addFiles(collectionId, [...selected]);
    setSelected(new Set());
    setAddToColId(null);
  };

  const handleUpdateTypes = useCallback(async (fileId: string, types: string[]) => {
    await updateFile(fileId, { types });
  }, [updateFile]);

  const handleAddToCollection = useCallback(async (collectionId: string, fileIds: string[]) => {
    await addFiles(collectionId, fileIds);
  }, [addFiles]);

  const handleRemoveFromCollection = useCallback(async (collectionId: string, fileIds: string[]) => {
    await removeFiles(collectionId, fileIds);
  }, [removeFiles]);

  const emptyMessage = search || fmtFilter || filterType || orgFilter || filterCollectionId
    ? 'No files match your filters.'
    : 'No files yet. Upload some to get started.';

  return (
    <div className="flex flex-col gap-3 md:gap-4 p-2 md:p-5 h-full min-h-0 animate-page-enter">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <Heading level="title">Files</Heading>
          <Text variant="dim">
            {data ? `${data.length.toLocaleString()} files` : isError ? '—' : <span className="skeleton h-[1lh] w-12 inline-block align-middle rounded-sm" />}
          </Text>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            {addToColId === null ? (
              <Button intent="ghost" size="sm" onClick={() => setAddToColId('')}>
                Add {selected.size} to collection
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                <CollectionPicker
                  value={addToColId}
                  onValueChange={handleBulkAddToCollection}
                  placeholder="Pick collection..."
                  variant="surface"
                  size="sm"
                  className="w-44"
                />
                <Button intent="ghost" size="sm" onClick={() => setAddToColId(null)}>Cancel</Button>
              </div>
            )}
            <Button intent="danger" size="sm" pending={deletePending} onClick={handleBulkDelete}>
              Delete {selected.size}
            </Button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Input
          variant="surface"
          size="md"
          placeholder="Search files..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full md:w-64"
        />
        <FilterChip label="All collections" items={colItems} value={filterCollectionId} onValueChange={setFilterCollectionId} />
        <FilterChip label="All types" items={typeItems} value={filterType} onValueChange={setFilterType} />
        <FilterChip label="All formats" items={formatItems} value={fmtFilter} onValueChange={setFmtFilter} />
        <FilterChip label="All organisms" items={orgItems} value={orgFilter} onValueChange={setOrgFilter} />
      </div>

      {/* Desktop — CSS Grid table, hidden below md */}
      <div className="hidden md:flex flex-col flex-1 min-h-0 border border-line rounded-md bg-base overflow-hidden">
        {/* Sticky header row */}
        <div className="shrink-0 border-b border-line bg-raised tbl-row">
          <div className="grid items-center" style={{ gridTemplateColumns: GRID_COLS, gap: '0 12px' }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-cyan cursor-pointer"
            />
            <Text variant="muted">File</Text>
            <Text variant="muted">Status</Text>
            <Text variant="muted">Uploaded</Text>
            <Text variant="muted">Organism</Text>
            <Text variant="muted">Type</Text>
            <Text variant="muted">Collections</Text>
            <div />
          </div>
        </div>

        <LoadingCrossfade
          isLoading={isLoading && !isError}
          skeleton={
            <div className="flex-1 overflow-auto min-h-0">
              {STUB_FILES.map((_, i) => <SkeletonGridRow key={i} />)}
            </div>
          }
        >
          {files.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Text variant="body" className="text-fg-3 animate-fade-up">{emptyMessage}</Text>
            </div>
          ) : (
            <div className="flex-1 overflow-auto min-h-0" style={{ scrollbarGutter: 'stable' }}>
              {files.map((f, i) => (
                <FileRow
                  key={f.id}
                  index={i}
                  id={f.id}
                  filename={f.filename}
                  format={f.format}
                  sizeBytes={f.sizeBytes}
                  status={f.status}
                  uploadedAt={f.uploadedAt}
                  types={f.types}
                  organisms={f.organisms}
                  collections={f.collections}
                  selected={selected.has(f.id)}
                  onSelect={toggleOne}
                  onDownload={handleDownload}
                  onUpdateTypes={handleUpdateTypes}
                  onAddOrganism={addFileOrganism}
                  onRemoveOrganism={removeFileOrganism}
                  onAddToCollection={handleAddToCollection}
                  onRemoveFromCollection={handleRemoveFromCollection}
                />
              ))}
            </div>
          )}
        </LoadingCrossfade>
      </div>

      {/* Mobile cards — visible below md */}
      <div className="flex flex-col gap-1.5 md:hidden flex-1 overflow-auto min-h-0">
        {!(isLoading && !isError) && files.length > 0 && (
          <label className="flex items-center gap-2 px-1 py-0.5">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-cyan cursor-pointer"
            />
            <Text variant="dim">Select all</Text>
          </label>
        )}

        <LoadingCrossfade
          isLoading={isLoading && !isError}
          skeleton={STUB_FILES.slice(0, 4).map(f => (
            <FileCard key={f.id} file={f} loading onDownload={handleDownload} selected={false} onSelect={toggleOne} />
          ))}
        >
          {files.length === 0
            ? <Text variant="body" className="py-8 text-center text-fg-3 animate-fade-up">{emptyMessage}</Text>
            : files.map((f, i) => (
              <div key={f.id} className="stagger-item" style={{ '--i': Math.min(i, 15) } as React.CSSProperties}>
                <FileCard
                  file={f}
                  selected={selected.has(f.id)}
                  onSelect={toggleOne}
                  onDownload={handleDownload}
                />
              </div>
            ))
          }
        </LoadingCrossfade>
      </div>
    </div>
  );
}
