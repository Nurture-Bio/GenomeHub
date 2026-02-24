import type { GenomicFile } from "../hooks/useGenomicQueries";
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import { Gigbag, Vamp, Hum } from 'concertina';
import {
  useFilesQuery, useDeleteFileMutation, useUpdateFileMutation,
  usePresignedUrl, useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddFileOrganism, useRemoveFileOrganism,
} from '../hooks/useGenomicQueries';
import { useConfirm } from '../hooks/useConfirm';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card, ChipEditor, HashPill, FilterChip, iconAction } from '../ui';
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
      style={{ background: selected ? 'var(--color-raised)' : undefined }}
    >
      {/* Top row: checkbox + format + filename */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(file.id, e.target.checked)}
          className="accent-cyan cursor-pointer shrink-0"
        />
        <HashPill label={meta.label} colorKey={fmt} />
        <Text variant="mono" className="truncate flex-1 min-w-0">{file.filename}</Text>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-2 flex-wrap pl-5.5">
        <Text variant="dim">{formatBytes(file.sizeBytes)}</Text>
        {file.types.map(t => <HashPill key={t} label={t} />)}
        {file.organisms.map(o => <HashPill key={o.id} label={o.displayName} />)}
        {file.status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
        {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
        {file.status === 'error'   && <Badge variant="status" color="red">error</Badge>}
        <Text variant="dim">{formatRelativeTime(file.uploadedAt)}</Text>
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
      className="border-b border-line transition-colors duration-fast hover:bg-base group"
      style={{ background: selected ? 'var(--color-raised)' : undefined }}
    >
      {/* Checkbox */}
      <td className="pl-3 pr-1 py-2 w-6 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(file.id, e.target.checked)}
          className="accent-cyan cursor-pointer"
        />
      </td>

      {/* File: icon + name + size */}
      <td className="py-2 pr-3 align-top min-w-0">
        <div className="flex items-start gap-2">
          <FormatIcon filename={file.filename} format={file.format} />
          <div className="min-w-0 flex-1">
            <Link to={`/files/${file.id}`} className="no-underline">
              <Text variant="mono" className="truncate block hover:text-cyan transition-colors duration-fast" style={{ fontSize: '0.75rem' }}>
                {file.filename}
              </Text>
            </Link>
            <Text variant="dim" style={{ fontSize: '0.75rem' }}>{formatBytes(file.sizeBytes)}</Text>
          </div>
        </div>
      </td>

      {/* Status — own column so badges align across all rows */}
      <td className="py-2 pr-2 align-top">
        {file.status === 'ready'   && <Badge variant="status" color="green">ready</Badge>}
        {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
        {file.status === 'error'   && <Badge variant="status" color="red">error</Badge>}
      </td>

      {/* Time — own column so timestamps align across all rows */}
      <td className="py-2 pr-3 align-top whitespace-nowrap">
        <Text variant="dim">{formatRelativeTime(file.uploadedAt)}</Text>
      </td>

      {/* Organism — ChipEditor */}
      <td className="py-1.5 pr-3 align-top overflow-hidden">
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
      <td className="py-1.5 pr-3 align-top overflow-hidden">
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
      <td className="py-1.5 pr-3 align-top overflow-hidden">
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
      <td className="py-2 pr-3 align-top">
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
    <Vamp loading>
      <tr className="border-b border-line">
        {/* Checkbox placeholder */}
        <td className="pl-3 pr-1 py-2 w-6 align-top">
          <div className="concertina-warmup-line rounded-sm" style={{ width: 'var(--target-min-icon)', height: 'var(--target-min-icon)' }} />
        </td>

        {/* File: icon shimmer + Hum filename + Hum size */}
        <td className="py-2 pr-3 align-top">
          <div className="flex items-start gap-2">
            <div className="concertina-warmup-line rounded-sm shrink-0" style={{ width: 'var(--format-icon-size)', height: 'var(--format-icon-size)' }} />
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <Hum className="font-mono block" style={{ fontSize: '0.75rem' }}>sequence_data_001.fastq.gz</Hum>
              <Hum className="block" style={{ fontSize: '0.75rem' }}>8.2 MB</Hum>
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="py-2 pr-2 align-top">
          <Hum className="text-body">ready</Hum>
        </td>

        {/* Time */}
        <td className="py-2 pr-3 align-top">
          <Hum className="text-body">2 hours ago</Hum>
        </td>

        {/* Organism / Type / Collections — pill shimmers */}
        <td className="py-1.5 pr-3 align-top">
          <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
        </td>
        <td className="py-1.5 pr-3 align-top">
          <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
        </td>
        <td className="py-1.5 pr-3 align-top">
          <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
        </td>

        <td />
      </tr>
    </Vamp>
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
  const [filterCollectionId, setFilterCollectionId] = useState('');
  const [filterType, setFilterType] = useState('');

  const { data, isLoading } = useFilesQuery({
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

  // Derive format and type filter items from actual data
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
  };

  const handleUpdateTypes = async (fileId: string, types: string[]) => {
    await updateFile(fileId, { types });
  };

  const handleAddToCollection = async (collectionId: string, fileIds: string[]) => {
    await addFiles(collectionId, fileIds);
  };

  const handleRemoveFromCollection = async (collectionId: string, fileIds: string[]) => {
    await removeFiles(collectionId, fileIds);
  };

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <Heading level="heading">Files</Heading>
          <Text variant="dim">
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

        <FilterChip label="All collections" items={colItems} value={filterCollectionId} onValueChange={setFilterCollectionId} />
        <FilterChip label="All types" items={typeItems} value={filterType} onValueChange={setFilterType} />
        <FilterChip label="All formats" items={formatItems} value={fmtFilter} onValueChange={setFmtFilter} />
        <FilterChip label="All organisms" items={orgItems} value={orgFilter} onValueChange={setOrgFilter} />
      </div>

      {/* Desktop table — hidden below md */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-line rounded-md bg-base" style={{ scrollbarGutter: 'stable' }}>
        <Gigbag className="w-full">
        <table className="w-full border-collapse text-left table-fixed">
          <thead className="sticky top-0 bg-raised z-10">
            <tr className="border-b border-line">
              <th className="pl-3 pr-1 py-1.5 w-7">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-cyan cursor-pointer"
                />
              </th>
              <th className="py-1.5 pr-3"><Text variant="muted">File</Text></th>
              <th className="py-1.5 pr-2 w-20"><Text variant="muted">Status</Text></th>
              <th className="py-1.5 pr-3 w-28"><Text variant="muted">Uploaded</Text></th>
              <th className="py-1.5 pr-3 w-36"><Text variant="muted">Organism</Text></th>
              <th className="py-1.5 pr-3 w-28"><Text variant="muted">Type</Text></th>
              <th className="py-1.5 pr-3 w-44"><Text variant="muted">Collections</Text></th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
              : files.length === 0
                ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
                      <Text variant="body" className="text-fg-3">
                        {search || fmtFilter || filterType || orgFilter || filterCollectionId ? 'No files match your filters.' : 'No files yet. Upload some to get started.'}
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
              className="accent-cyan cursor-pointer"
            />
            <Text variant="dim">Select all</Text>
          </label>
        )}

        {isLoading
          ? [...Array(4)].map((_, i) => <SkeletonCard key={i} />)
          : files.length === 0
            ? (
              <Text variant="body" className="py-8 text-center text-fg-3">
                {search || fmtFilter || filterType || orgFilter || filterCollectionId ? 'No files match your filters.' : 'No files yet. Upload some to get started.'}
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
