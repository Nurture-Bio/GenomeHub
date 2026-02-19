import type { GenomicFile } from "../hooks/useGenomicQueries";
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import {
  useFilesQuery, useDeleteFileMutation, useUpdateFileMutation,
  usePresignedUrl, useAddFilesToCollection, useRemoveFilesFromCollection,
} from '../hooks/useGenomicQueries';
import { useConfirm } from '../hooks/useConfirm';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card, iconAction, chip } from '../ui';
import { CollectionPicker, OrganismPicker, FileKindPicker } from '../ui';

// ── Format icon ──────────────────────────────────────────

function FormatIcon({ filename, format, size = 32 }: { filename: string; format?: string; size?: number }) {
  const fmt   = format ?? detectFormat(filename);
  const meta  = FORMAT_META[fmt] ?? FORMAT_META['other'];
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

// ── Inline collection editor ─────────────────────────────

function InlineCollectionEditor({
  fileId, collections, onAdd, onRemove,
}: {
  fileId: string;
  collections: { id: string; name: string | null }[];
  onAdd: (collectionId: string, fileIds: string[]) => Promise<void>;
  onRemove: (collectionId: string, fileIds: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex gap-0.5 flex-wrap items-center">
      {collections.map(c => (
        <span key={c.id} className={chip()}>
          <Link to={`/collections/${c.id}`} className="no-underline text-text-secondary hover:text-accent">
            {c.name}
          </Link>
          <button
            className={iconAction({ color: 'dim' })}
            style={{ fontSize: 'var(--font-size-micro)' }}
            onClick={() => onRemove(c.id, [fileId])}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <CollectionPicker
          value=""
          onValueChange={v => {
            if (v) onAdd(v, [fileId]);
            setAdding(false);
          }}
          placeholder="Collection..."
          variant="surface"
          size="sm"
          className="w-32"
        />
      ) : (
        <button
          className={iconAction({ color: 'dim' })}
          style={{ fontSize: 'var(--font-size-micro)' }}
          onClick={() => setAdding(true)}
        >
          +
        </button>
      )}
    </div>
  );
}

// ── Mobile file card ────────────────────────────────────

interface FileCardProps {
  file: GenomicFile;
  onDownload: (id: string) => void;
  selected: boolean;
  onSelect: (id: string, sel: boolean) => void;
}

function FileCard({ file, onDownload, selected, onSelect }: FileCardProps) {
  const meta = FORMAT_META[file.format] ?? FORMAT_META['other'];

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
        <Badge variant="status" style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </Badge>
        <Text variant="mono" className="truncate flex-1 min-w-0">{file.filename}</Text>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-2 flex-wrap pl-5.5">
        <Text variant="caption">{formatBytes(file.sizeBytes)}</Text>
        {file.status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
        {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
        {file.status === 'error'   && <Badge variant="status" color="red">error</Badge>}
        <Text variant="caption">{formatRelativeTime(file.uploadedAt)}</Text>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 pl-5.5">
        <Button intent="ghost" size="sm" onClick={() => onDownload(file.id)}>Download</Button>
      </div>
    </Card>
  );
}

// ── File row (desktop table) ────────────────────────────

interface FileRowProps {
  file: GenomicFile;
  onDownload: (id: string) => void;
  onUpdate: (id: string, patch: { kind?: string; format?: string; organismId?: string | null; tags?: string[] }) => void;
  onAddToCollection: (collectionId: string, fileIds: string[]) => Promise<void>;
  onRemoveFromCollection: (collectionId: string, fileIds: string[]) => Promise<void>;
  selected: boolean;
  onSelect: (id: string, sel: boolean) => void;
}

function FileRow({ file, onDownload, onUpdate, onAddToCollection, onRemoveFromCollection, selected, onSelect }: FileRowProps) {
  return (
    <tr
      className="border-b border-border-subtle transition-colors duration-fast hover:bg-surface group"
      style={{ background: selected ? 'var(--color-surface-2)' : undefined }}
    >
      {/* Checkbox */}
      <td className="pl-3 pr-1 py-1.5 w-6 align-top pt-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(file.id, e.target.checked)}
          className="accent-accent cursor-pointer"
        />
      </td>

      {/* File: icon + name (line 1), size · status · date (line 2) */}
      <td className="py-1.5 pr-3">
        <div className="flex items-center gap-2">
          <FormatIcon filename={file.filename} format={file.format} size={28} />
          <div className="min-w-0 flex-1">
            <Link to={`/files/${file.id}`} className="no-underline">
              <Text variant="mono" className="truncate block hover:text-accent transition-colors duration-fast">
                {file.filename}
              </Text>
            </Link>
            <div className="flex items-center gap-1.5">
              <Text variant="mono" className="text-text-dim text-micro">{formatBytes(file.sizeBytes)}</Text>
              <Text variant="caption">·</Text>
              {file.status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
              {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
              {file.status === 'error'   && <Badge variant="status" color="red">error</Badge>}
              <Text variant="caption">·</Text>
              <Text variant="caption">{formatRelativeTime(file.uploadedAt)}</Text>
            </div>
          </div>
        </div>
      </td>

      {/* Organism — always-rendered dropdown */}
      <td className="py-1.5 pr-3 w-36 align-top pt-2">
        <OrganismPicker
          value={file.organismId ?? ''}
          onValueChange={v => onUpdate(file.id, { organismId: v || null })}
          variant="surface" size="sm" className="w-full"
        />
      </td>

      {/* Kind — always-rendered dropdown */}
      <td className="py-1.5 pr-3 w-28 align-top pt-2">
        <FileKindPicker
          value={file.kind}
          onValueChange={v => onUpdate(file.id, { kind: v })}
          variant="surface" size="sm" className="w-full"
        />
      </td>

      {/* Collections */}
      <td className="py-1.5 pr-3">
        <InlineCollectionEditor
          fileId={file.id}
          collections={file.collections}
          onAdd={onAddToCollection}
          onRemove={onRemoveFromCollection}
        />
      </td>

      {/* Download */}
      <td className="py-1.5 pr-3 w-6 align-top pt-2">
        <button
          onClick={() => onDownload(file.id)}
          className={iconAction({ color: 'dim', reveal: true })}
          title="Download"
        >
          ↓
        </button>
      </td>
    </tr>
  );
}

// ── Skeleton row ─────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(6)].map((_, i) => (
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

export default function FilesPage() {
  const [filterCollectionId, setFilterCollectionId] = useState('');
  const [filterKind, setFilterKind] = useState('');

  const { data, isLoading, refetch } = useFilesQuery({
    collectionId: filterCollectionId || undefined,
    kind: filterKind || undefined,
  });
  const { deleteFile, pending: deletePending } = useDeleteFileMutation(refetch);
  const { updateFile } = useUpdateFileMutation(refetch);
  const { addFiles } = useAddFilesToCollection();
  const { removeFiles } = useRemoveFilesFromCollection();
  const { getUrl } = usePresignedUrl();
  const { confirm, dialog } = useConfirm();

  // Derive format and kind filters from actual data
  const formatFilters = useMemo(() => {
    if (!data) return ['all'];
    const fmts = new Set(data.map(f => f.format));
    return ['all', ...Array.from(fmts).sort()];
  }, [data]);

  const kindFilters = useMemo(() => {
    if (!data) return ['all'];
    const kinds = new Set(data.map(f => f.kind).filter(Boolean));
    return ['all', ...Array.from(kinds).sort()];
  }, [data]);

  const [search,     setSearch]     = useState('');
  const [fmtFilter,  setFmtFilter]  = useState<string>('all');
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [addToColId, setAddToColId] = useState<string | null>(null);

  const files = useMemo(() => {
    if (!data) return [];
    return data.filter(f => {
      const q = search.toLowerCase();
      const matchSearch = !search || f.filename.toLowerCase().includes(q)
        || (f.organismDisplay?.toLowerCase().includes(q) ?? false)
        || f.collections.some(c => c.name?.toLowerCase().includes(q))
        || f.tags.some(t => t.toLowerCase().includes(q));
      const matchFmt = fmtFilter === 'all' || f.format === fmtFilter;
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

  const handleBulkAddToCollection = async (collectionId: string) => {
    if (!collectionId || selected.size === 0) return;
    await addFiles(collectionId, [...selected]);
    setSelected(new Set());
    setAddToColId(null);
    refetch();
  };

  const handleInlineUpdate = async (fileId: string, patch: { kind?: string; format?: string; organismId?: string | null; tags?: string[] }) => {
    await updateFile(fileId, patch);
  };

  const handleAddToCollection = async (collectionId: string, fileIds: string[]) => {
    await addFiles(collectionId, fileIds);
    refetch();
  };

  const handleRemoveFromCollection = async (collectionId: string, fileIds: string[]) => {
    await removeFiles(collectionId, fileIds);
    refetch();
  };

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {dialog}
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <Heading level="heading">Files</Heading>
          <Text variant="caption">
            {data ? `${data.length.toLocaleString()} files` : 'Loading...'}
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

        <CollectionPicker
          value={filterCollectionId}
          onValueChange={setFilterCollectionId}
          placeholder="All collections"
          variant="surface"
          size="md"
          className="w-full sm:w-44"
        />

        <div className="flex gap-1 flex-wrap">
          {kindFilters.map(k => {
            const active = k === 'all' ? !filterKind : filterKind === k;
            return (
              <button
                key={k}
                onClick={() => setFilterKind(k === 'all' ? '' : k)}
                className="font-body text-micro px-1.5 py-1 md:py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer min-h-5.5 md:min-h-0"
                style={{
                  background: active ? 'var(--color-accent)' : 'var(--color-surface-2)',
                  color:      active ? 'var(--color-bg)'     : 'var(--color-text-secondary)',
                  borderColor: active ? 'transparent'        : 'var(--color-border)',
                }}
              >
                {k === 'all' ? 'All kinds' : k}
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 flex-wrap">
          {formatFilters.map(f => {
            const active = fmtFilter === f;
            return (
              <button
                key={f}
                onClick={() => setFmtFilter(f)}
                className="font-body text-micro px-1.5 py-1 md:py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer min-h-5.5 md:min-h-0"
                style={{
                  background: active ? 'var(--color-accent)' : 'var(--color-surface-2)',
                  color:      active ? 'var(--color-bg)'     : 'var(--color-text-secondary)',
                  borderColor: active ? 'transparent'        : 'var(--color-border)',
                }}
              >
                {f === 'all' ? 'All formats' : FORMAT_META[f as keyof typeof FORMAT_META]?.label ?? f}
              </button>
            );
          })}
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
              {['File', 'Organism', 'Kind', 'Collections', ''].map(h => (
                <th key={h} className="py-1.5 pr-3">
                  <Text variant="overline">{h}</Text>
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
                    <td colSpan={6} className="py-12 text-center">
                      <Text variant="body" className="text-text-dim">
                        {search || fmtFilter !== 'all' || filterCollectionId ? 'No files match your filters.' : 'No files yet. Upload some to get started.'}
                      </Text>
                    </td>
                  </tr>
                )
                : files.map(f => (
                  <FileRow
                    key={f.id}
                    file={f}
                    selected={selected.has(f.id)}
                    onSelect={toggleOne}
                    onDownload={handleDownload}
                    onUpdate={handleInlineUpdate}
                    onAddToCollection={handleAddToCollection}
                    onRemoveFromCollection={handleRemoveFromCollection}
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
              <Text variant="body" className="py-8 text-center text-text-dim">
                {search || fmtFilter !== 'all' || filterCollectionId ? 'No files match your filters.' : 'No files yet. Upload some to get started.'}
              </Text>
            )
            : files.map(f => (
              <FileCard
                key={f.id}
                file={f}
                selected={selected.has(f.id)}
                onSelect={toggleOne}
                onDownload={handleDownload}
              />
            ))
        }
      </div>
    </div>
  );
}
