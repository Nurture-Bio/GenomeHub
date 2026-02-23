import type { GenomicFile } from "../hooks/useGenomicQueries";
import { useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import { Gigbag } from 'concertina';
import {
  useFilesQuery, useDeleteFileMutation, useUpdateFileMutation,
  usePresignedUrl, useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddFileOrganism, useRemoveFileOrganism, useOverlayMutation,
} from '../hooks/useGenomicQueries';
import { useConfirm } from '../hooks/useConfirm';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { hashColor } from '../lib/colors';
import { Button, Badge, Input, Text, Heading, Card, ChipEditor, HashPill, iconAction } from '../ui';
import { CollectionPicker, OrganismPicker, FileTypePicker } from '../ui';

// ── Format icon ──────────────────────────────────────────

function FormatIcon({ filename, format, className }: { filename: string; format?: string; className?: string }) {
  const fmt   = format ?? detectFormat(filename);
  const meta  = FORMAT_META[fmt] ?? FORMAT_META['other'];
  return (
    <div
      className={cx('format-icon shrink-0 font-mono font-bold', className)}
      style={{ background: meta.bg, color: meta.color }}
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
  const fmt  = file.format;
  const meta = FORMAT_META[fmt] ?? FORMAT_META['other'];

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
        <HashPill label={meta.label} colorKey={fmt} />
        <Text variant="mono" className="truncate flex-1 min-w-0">{file.filename}</Text>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-2 flex-wrap pl-5.5">
        <Text variant="caption">{formatBytes(file.sizeBytes)}</Text>
        {file.types.map(t => <HashPill key={t} label={t} />)}
        {file.organisms.map(o => <HashPill key={o.id} label={o.displayName} />)}
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
          <FormatIcon filename={file.filename} format={file.format} />
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
      <td className="py-1.5 pr-3 align-top pt-2 overflow-hidden">
        <ChipEditor
          colored
          items={file.organisms.map(o => ({ id: o.id, label: o.displayName }))}
          onAdd={id => onAddOrganism(file.id, id)}
          onRemove={id => onRemoveOrganism(file.id, id)}
          renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-32" />}
          maxVisible={2}
        />
      </td>

      {/* Type — ChipEditor */}
      <td className="py-1.5 pr-3 align-top pt-2 overflow-hidden">
        <ChipEditor
          colored
          items={file.types.map(t => ({ id: t, label: t }))}
          onAdd={id => onUpdateTypes(file.id, [...file.types, id])}
          onRemove={id => onUpdateTypes(file.id, file.types.filter(t => t !== id))}
          renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
          maxVisible={2}
        />
      </td>

      {/* Collections */}
      <td className="py-1.5 pr-3 overflow-hidden">
        <ChipEditor
          colored
          items={file.collections.map(c => ({ id: c.id, label: c.name ?? '' }))}
          onAdd={id => onAddToCollection(id, [file.id])}
          onRemove={id => onRemoveFromCollection(id, [file.id])}
          renderPicker={p => <CollectionPicker {...p} variant="surface" size="sm" className="w-32" />}
          renderLabel={item => (
            <Link to={`/collections/${item.id}`} className="no-underline hover:opacity-80">
              {item.label}
            </Link>
          )}
        />
      </td>

      {/* Download */}
      <td className="py-1.5 pr-3 align-top pt-2">
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
      <td className="pl-3 pr-1 py-1.5 w-6 align-top pt-2.5">
        <div className="concertina-warmup-line rounded-sm" style={{ width: 'var(--target-min-icon)', height: 'var(--target-min-icon)' }} />
      </td>
      <td className="py-1.5 pr-3">
        <div className="flex items-center gap-2">
          <div className="concertina-warmup-line rounded-sm shrink-0" style={{ width: 'var(--format-icon-size)', height: 'var(--format-icon-size)' }} />
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="concertina-warmup-line concertina-warmup-line-long" />
            <div className="concertina-warmup-line concertina-warmup-line-short" />
          </div>
        </div>
      </td>
      <td className="py-1.5 pr-3 align-top pt-2">
        <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
      </td>
      <td className="py-1.5 pr-3 align-top pt-2">
        <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
      </td>
      <td className="py-1.5 pr-3 align-top pt-2">
        <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
      </td>
      <td />
    </tr>
  );
}

// ── Skeleton card (mobile) ──────────────────────────────

function SkeletonCard() {
  return (
    <Card className="p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="concertina-warmup-line rounded-sm" style={{ width: 'var(--target-min-icon)', height: 'var(--target-min-icon)' }} />
        <div className="concertina-warmup-line rounded-sm shrink-0" style={{ width: 'var(--format-icon-size)', height: 'var(--format-icon-size)' }} />
        <div className="concertina-warmup-line concertina-warmup-line-long flex-1" />
      </div>
      <div className="flex gap-2 pl-11">
        <div className="concertina-warmup-line concertina-warmup-line-short flex-1" />
        <div className="concertina-warmup-line concertina-warmup-line-short rounded-full flex-1" />
        <div className="concertina-warmup-line concertina-warmup-line-short flex-1" />
      </div>
    </Card>
  );
}

// ── FilesPage ─────────────────────────────────────────────

export default function FilesPage() {
  const navigate = useNavigate();
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
  const { confirm } = useConfirm();
  const { overlay, pending: overlayPending } = useOverlayMutation();

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
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayQueryId, setOverlayQueryId] = useState<string | null>(null);
  const [overlayNameTag, setOverlayNameTag] = useState('feature_type');

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

  // Overlay: exactly 2 selected JSON files
  const selectedFiles = useMemo(() => {
    if (!data) return [];
    return data.filter(f => selected.has(f.id));
  }, [data, selected]);

  const canOverlay = selectedFiles.length === 2
    && selectedFiles.every(f => f.format === 'json');

  const handleOpenOverlay = () => {
    setOverlayQueryId(selectedFiles[0].id);
    setOverlayNameTag('feature_type');
    setOverlayOpen(true);
  };

  const handleRunOverlay = async () => {
    if (!overlayQueryId || selectedFiles.length !== 2) return;
    const refId = selectedFiles.find(f => f.id !== overlayQueryId)!.id;
    try {
      const result = await overlay(overlayQueryId, refId, overlayNameTag || undefined);
      setOverlayOpen(false);
      setSelected(new Set());
      refetch();
      navigate(`/files/${result.fileId}`);
    } catch {
      // toast already shown by mutation
    }
  };

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
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
            {canOverlay && (
              <Button intent="primary" size="sm" onClick={handleOpenOverlay}>
                Overlay
              </Button>
            )}
            <Button intent="danger" size="sm" pending={deletePending} onClick={handleBulkDelete}>
              Delete {selected.size}
            </Button>
          </div>
        )}
      </div>

      {/* Overlay dialog */}
      {overlayOpen && (
        <Card className="p-3 flex flex-col gap-2 border-accent/30">
          <div className="flex items-center justify-between">
            <Text variant="overline">Overlay</Text>
            <button onClick={() => setOverlayOpen(false)} className={iconAction({ color: 'dim' })}>
              × close
            </button>
          </div>
          <Text variant="caption">
            Pick which file is the query (its regions are kept) and which is the reference
            (its names/tags are merged onto overlapping query regions).
          </Text>
          <div className="flex flex-col gap-1.5">
            {selectedFiles.map(f => (
              <label
                key={f.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer border transition-colors duration-fast ${
                  overlayQueryId === f.id ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name="overlay-query"
                  checked={overlayQueryId === f.id}
                  onChange={() => setOverlayQueryId(f.id)}
                  className="accent-accent"
                />
                <div className="flex-1 min-w-0">
                  <Text variant="mono" className="truncate block">{f.filename}</Text>
                </div>
                <Badge variant="count" color={overlayQueryId === f.id ? 'accent' : 'dim'}>
                  {overlayQueryId === f.id ? 'query' : 'reference'}
                </Badge>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Text variant="caption" className="shrink-0">Name tag:</Text>
            <Input
              variant="surface"
              size="sm"
              value={overlayNameTag}
              onChange={e => setOverlayNameTag(e.target.value)}
              placeholder="feature_type"
              className="w-40"
            />
          </div>
          <div className="flex gap-1.5 justify-end">
            <Button intent="ghost" size="sm" onClick={() => setOverlayOpen(false)}>Cancel</Button>
            <Button intent="primary" size="sm" pending={overlayPending} onClick={handleRunOverlay}>
              Run Overlay
            </Button>
          </div>
        </Card>
      )}

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
            const hc = k === 'all' ? null : hashColor(k);
            return (
              <button
                key={k}
                onClick={() => setFilterType(k === 'all' ? '' : k)}
                className="hash-filter-btn"
                data-active={active}
                style={hc ? { '--hc-bg': hc.bg, '--hc-fg': hc.color } as CSSProperties : undefined}
              >
                {k === 'all' ? 'All types' : k}
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 flex-wrap">
          {formatFilters.map(f => {
            const active = fmtFilter === f;
            const meta = f === 'all' ? null : FORMAT_META[f];
            return (
              <button
                key={f}
                onClick={() => setFmtFilter(f)}
                className="hash-filter-btn"
                data-active={active}
                style={meta ? { '--hc-bg': meta.bg, '--hc-fg': meta.color } as CSSProperties : undefined}
              >
                {f === 'all' ? 'All formats' : meta?.label ?? f}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop table — hidden below md */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface" style={{ scrollbarGutter: 'stable' }}>
        <Gigbag className="w-full">
        <table className="w-full border-collapse text-left table-fixed">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="border-b border-border">
              <th className="pl-3 pr-1 py-1.5 w-7">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-accent cursor-pointer"
                />
              </th>
              <th className="py-1.5 pr-3"><Text variant="overline">File</Text></th>
              <th className="py-1.5 pr-3 w-36"><Text variant="overline">Organism</Text></th>
              <th className="py-1.5 pr-3 w-28"><Text variant="overline">Type</Text></th>
              <th className="py-1.5 pr-3 w-44"><Text variant="overline">Collections</Text></th>
              <th className="w-8" />
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
        </Gigbag>
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
