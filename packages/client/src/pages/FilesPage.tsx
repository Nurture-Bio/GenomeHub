import type { GenomicFile } from "../hooks/useGenomicQueries";
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import {
  useFilesQuery, useDeleteFileMutation, useUpdateFileMutation,
  usePresignedUrl, useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddFileOrganism, useRemoveFileOrganism,
} from '../hooks/useGenomicQueries';
import { useConfirm } from '../hooks/useConfirm';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card, ChipEditor, iconAction, chip } from '../ui';
import { CollectionPicker, OrganismPicker, FileTypePicker } from '../ui';

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
        {file.types.map(t => <Badge key={t} variant="count" color="dim">{t}</Badge>)}
        {file.organisms.map(o => <Text key={o.id} variant="caption" className="italic">{o.displayName}</Text>)}
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
  onUpdateTypes: (id: string, types: string[]) => void;
  onAddOrganism: (fileId: string, orgId: string) => void;
  onRemoveOrganism: (fileId: string, orgId: string) => void;
  onAddToCollection: (collectionId: string, fileIds: string[]) => Promise<void>;
  onRemoveFromCollection: (collectionId: string, fileIds: string[]) => Promise<void>;
  selected: boolean;
  onSelect: (id: string, sel: boolean) => void;
}

function FileRow({ file, onDownload, onUpdateTypes, onAddOrganism, onRemoveOrganism, onAddToCollection, onRemoveFromCollection, selected, onSelect }: FileRowProps) {
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

      {/* Organism — ChipEditor */}
      <td className="py-1.5 pr-3 w-36 align-top pt-2">
        <ChipEditor
          items={file.organisms.map(o => ({ id: o.id, label: o.displayName }))}
          onAdd={id => onAddOrganism(file.id, id)}
          onRemove={id => onRemoveOrganism(file.id, id)}
          renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-32" />}
          maxVisible={2}
        />
      </td>

      {/* Type — ChipEditor */}
      <td className="py-1.5 pr-3 w-28 align-top pt-2">
        <ChipEditor
          items={file.types.map(t => ({ id: t, label: t }))}
          onAdd={id => onUpdateTypes(file.id, [...file.types, id])}
          onRemove={id => onUpdateTypes(file.id, file.types.filter(t => t !== id))}
          renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
          maxVisible={2}
        />
      </td>

      {/* Collections */}
      <td className="py-1.5 pr-3">
        <ChipEditor
          items={file.collections.map(c => ({ id: c.id, label: c.name ?? '' }))}
          onAdd={id => onAddToCollection(id, [file.id])}
          onRemove={id => onRemoveFromCollection(id, [file.id])}
          renderPicker={p => <CollectionPicker {...p} variant="surface" size="sm" className="w-32" />}
          renderLabel={item => (
            <Link to={`/collections/${item.id}`} className="no-underline text-text-secondary hover:text-accent">
              {item.label}
            </Link>
          )}
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
  const [filterType, setFilterType] = useState('');

  const { data, isLoading, refetch } = useFilesQuery({
    collectionId: filterCollectionId || undefined,
    type: filterType || undefined,
  });
  const { deleteFile, pending: deletePending } = useDeleteFileMutation(refetch);
  const { updateFile } = useUpdateFileMutation(refetch);
  const { addFiles } = useAddFilesToCollection();
  const { removeFiles } = useRemoveFilesFromCollection();
  const { addFileOrganism } = useAddFileOrganism(refetch);
  const { removeFileOrganism } = useRemoveFileOrganism(refetch);
  const { getUrl } = usePresignedUrl();
  const { confirm, dialog } = useConfirm();

  // Derive format and type filters from actual data
  const formatFilters = useMemo(() => {
    if (!data) return ['all'];
    const fmts = new Set(data.map(f => f.format));
    return ['all', ...Array.from(fmts).sort()];
  }, [data]);

  const typeFilters = useMemo(() => {
    if (!data) return ['all'];
    const types = new Set(data.flatMap(f => f.types).filter(Boolean));
    return ['all', ...Array.from(types).sort()];
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
        || f.organisms.some(o => o.displayName.toLowerCase().includes(q))
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

  const handleUpdateTypes = async (fileId: string, types: string[]) => {
    await updateFile(fileId, { types });
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
          {typeFilters.map(k => {
            const active = k === 'all' ? !filterType : filterType === k;
            return (
              <button
                key={k}
                onClick={() => setFilterType(k === 'all' ? '' : k)}
                className="font-body text-micro px-1.5 py-1 md:py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer min-h-5.5 md:min-h-0"
                style={{
                  background: active ? 'var(--color-accent)' : 'var(--color-surface-2)',
                  color:      active ? 'var(--color-bg)'     : 'var(--color-text-secondary)',
                  borderColor: active ? 'transparent'        : 'var(--color-border)',
                }}
              >
                {k === 'all' ? 'All types' : k}
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
              {['File', 'Organism', 'Type', 'Collections', ''].map(h => (
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
                    onUpdateTypes={handleUpdateTypes}
                    onAddOrganism={addFileOrganism}
                    onRemoveOrganism={removeFileOrganism}
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
