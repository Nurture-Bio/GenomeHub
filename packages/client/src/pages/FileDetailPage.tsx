import { lazy, Suspense, useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useFileDetailQuery, useFilesQuery, useUpdateFileMutation,
  useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddProvenance, useRemoveProvenance,
  usePresignedUrl, useDeleteFileMutation,
  useAddFileOrganism, useRemoveFileOrganism,
} from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, TEXT_PREVIEW_FORMATS, formatBytes, formatRelativeTime } from '../lib/formats';
import { Heading, Text, Card, Badge, Button, InlineInput, Input, ChipEditor, HashPill, iconAction } from '../ui';
import { CollectionPicker, OrganismPicker, FileTypePicker, RelationPicker } from '../ui';
import LinksList from '../components/LinksList';

const FilePreview = lazy(() => import('../components/FilePreview'));
import { useAppStore } from '../stores/useAppStore';

const RELATION_LABELS: Record<string, string> = {
  derived_from: 'derived from',
  sequenced_from: 'sequenced from',
  produced_by: 'produced by',
};

function RelationLabel({ relation }: { relation: string }) {
  return (
    <Badge variant="count" color="dim">
      {RELATION_LABELS[relation] ?? relation.replace(/_/g, ' ')}
    </Badge>
  );
}

// ── Format pill ──────────────────────────────────────────

function FormatPill({ filename }: { filename: string }) {
  const fmt = detectFormat(filename);
  const meta = FORMAT_META[fmt];
  return <HashPill label={meta.label} colorKey={fmt} />;
}

export default function FileDetailPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const { data: file, isLoading, refetch } = useFileDetailQuery(fileId);
  const { updateFile } = useUpdateFileMutation(refetch);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);
  const { getUrl } = usePresignedUrl();
  const { deleteFile } = useDeleteFileMutation();

  const { addFiles: addToCol } = useAddFilesToCollection();
  const { removeFiles: removeFromCol } = useRemoveFilesFromCollection();
  const { addFileOrganism } = useAddFileOrganism(refetch);
  const { removeFileOrganism } = useRemoveFileOrganism(refetch);

  const [addingProv, setAddingProv] = useState(false);
  const [provSearch, setProvSearch] = useState('');
  const [provRelation, setProvRelation] = useState('derived_from');
  const [provTargetId, setProvTargetId] = useState<string | null>(null);
  const { addProvenance, pending: addProvPending } = useAddProvenance();
  const { removeProvenance, pending: removeProvPending } = useRemoveProvenance();

  const { data: allFiles } = useFilesQuery(addingProv ? {} : undefined as any);

  useEffect(() => {
    if (file && fileId) setBreadcrumbLabel(fileId, file.filename);
  }, [file, fileId, setBreadcrumbLabel]);

  const searchableFiles = useMemo(() => {
    if (!allFiles || !file) return [];
    const q = provSearch.toLowerCase();
    return allFiles
      .filter(f => f.id !== file.id)
      .filter(f => !q || f.filename.toLowerCase().includes(q) || f.types.some(t => t.toLowerCase().includes(q)));
  }, [allFiles, file, provSearch]);

  const handleAddToCollection = async (collectionId: string, fileIds: string[]) => {
    await addToCol(collectionId, fileIds);
    refetch();
  };

  const handleRemoveFromCollection = async (collectionId: string, fileIds: string[]) => {
    await removeFromCol(collectionId, fileIds);
    refetch();
  };

  const handleAddProvenance = async () => {
    if (!fileId || !provTargetId) return;
    await addProvenance(fileId, provTargetId, provRelation);
    setProvTargetId(null);
    setProvSearch('');
    setAddingProv(false);
    refetch();
  };

  const handleRemoveProvenance = async (edgeId: string) => {
    if (!fileId) return;
    await removeProvenance(fileId, edgeId);
    refetch();
  };

  const handleDownload = async () => {
    if (!fileId) return;
    const url = await getUrl(fileId);
    window.open(url, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <div className="skeleton h-6 w-64 rounded-sm" />
        <div className="skeleton h-4 w-48 rounded-sm" />
        <div className="skeleton h-32 rounded-md" />
      </div>
    );
  }

  if (!file) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <Heading level="heading">File not found</Heading>
        <Text variant="caption">The file may have been deleted.</Text>
      </div>
    );
  }

  const fmt = detectFormat(file.filename);
  const meta = FORMAT_META[fmt];

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <HashPill label={meta.label} colorKey={fmt} />
          {file.types.map(t => <HashPill key={t} label={t} />)}
          {file.status === 'ready' && <Badge variant="status" color="green">ready</Badge>}
          {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
          {file.status === 'error' && <Badge variant="status" color="red">error</Badge>}
        </div>
        <Heading level="heading">{file.filename}</Heading>

        <div className="mt-0.5">
          <InlineInput
            value={file.description ?? ''}
            placeholder="add description"
            onCommit={v => { if (fileId) updateFile(fileId, { description: v || null }); }}
          />
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Text variant="caption">{formatBytes(file.sizeBytes)}</Text>
          {file.md5 && <Text variant="mono" className="text-text-dim text-micro">MD5: {file.md5.slice(0, 12)}...</Text>}
          <Text variant="caption">Uploaded {formatRelativeTime(file.uploadedAt)}</Text>
          {file.uploadedBy && <Text variant="caption">by {file.uploadedBy}</Text>}
        </div>

        {/* Organisms */}
        <div className="flex items-center gap-2 mt-1">
          <Text variant="caption" className="shrink-0">Organisms:</Text>
          <ChipEditor
            colored
            items={file.organisms.map(o => ({ id: o.id, label: o.displayName }))}
            onAdd={id => { if (fileId) addFileOrganism(fileId, id); }}
            onRemove={id => { if (fileId) removeFileOrganism(fileId, id); }}
            renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-40" />}
          />
        </div>

        {/* Types */}
        <div className="flex items-center gap-2 mt-1">
          <Text variant="caption" className="shrink-0">Types:</Text>
          <ChipEditor
            colored
            items={file.types.map(t => ({ id: t, label: t }))}
            onAdd={id => { if (fileId) updateFile(fileId, { types: [...file.types, id] }); }}
            onRemove={id => { if (fileId) updateFile(fileId, { types: file.types.filter(t => t !== id) }); }}
            renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
          />
        </div>

        {file.tags.length > 0 && (
          <div className="flex gap-0.5 flex-wrap mt-1">
            {file.tags.map(t => <Badge key={t} variant="count" color="dim">{t}</Badge>)}
          </div>
        )}
        <div className="flex gap-1.5 mt-2">
          <Button intent="primary" size="sm" onClick={handleDownload}>Download</Button>
        </div>
      </div>

      {/* File preview — lazy loaded, only for text formats */}
      {file.status === 'ready' && TEXT_PREVIEW_FORMATS.has(fmt) && (
        <Suspense fallback={<div className="skeleton h-32 rounded-md" />}>
          <FilePreview fileId={fileId!} filename={file.filename} />
        </Suspense>
      )}

      {/* Collections */}
      <div>
        <Text variant="overline" className="mb-1.5 block">Collections</Text>
        <ChipEditor
          items={file.collections.map(c => ({ id: c.id, label: c.name }))}
          onAdd={id => handleAddToCollection(id, [fileId!])}
          onRemove={id => handleRemoveFromCollection(id, [fileId!])}
          renderPicker={p => <CollectionPicker {...p} variant="surface" size="sm" className="w-44" />}
          renderLabel={item => (
            <Link to={`/collections/${item.id}`} className="no-underline text-text-secondary hover:text-accent">
              {item.label}
            </Link>
          )}
        />
      </div>

      {/* Data Links */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="overline" className="flex-1">Data Links</Text>
          <button
            onClick={() => { setAddingProv(!addingProv); setProvTargetId(null); setProvSearch(''); }}
            className={iconAction({ color: 'dim' })}
          >
            {addingProv ? '× close' : '+ add link'}
          </button>
        </div>

        {addingProv && (
          <div className="border border-border rounded-md p-2.5 mb-2 bg-surface-2">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Text variant="caption" className="shrink-0">This file</Text>
              <RelationPicker
                value={provRelation}
                onValueChange={setProvRelation}
                placeholder="Relation"
                variant="surface"
                size="sm"
                className="w-40"
              />
              <Text variant="caption" className="shrink-0">→</Text>
              <Input
                variant="surface"
                size="sm"
                placeholder="Search files..."
                value={provSearch}
                onChange={e => { setProvSearch(e.target.value); setProvTargetId(null); }}
                className="flex-1 min-w-32"
              />
              <span className={`transition-opacity duration-fast ${provTargetId ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <button
                  disabled={addProvPending}
                  onClick={handleAddProvenance}
                  className={iconAction({ color: 'accent' })}
                  title="Add link"
                >
                  ✓
                </button>
              </span>
            </div>
            {provSearch && (
              <div className="max-h-36 overflow-auto flex flex-col gap-0.5">
                {searchableFiles.length === 0 ? (
                  <Text variant="caption" className="py-2 text-center">No matching files.</Text>
                ) : (
                  searchableFiles.slice(0, 30).map(f => (
                    <button
                      key={f.id}
                      onClick={() => { setProvTargetId(f.id); setProvSearch(f.filename); }}
                      className={`flex items-center gap-2 px-1.5 py-1 rounded-sm cursor-pointer border-none text-left w-full transition-colors duration-fast ${
                        provTargetId === f.id ? 'bg-accent/10' : 'bg-transparent hover:bg-surface'
                      }`}
                    >
                      <FormatPill filename={f.filename} />
                      <Text variant="mono" className="truncate flex-1 min-w-0">{f.filename}</Text>
                      {f.types.map(t => <Badge key={t} variant="count" color="dim">{t}</Badge>)}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {file.provenance.upstream.length > 0 && (
          <div className="mb-2">
            <Text variant="caption" className="mb-1 block text-text-dim">This file was created from:</Text>
            <div className="flex flex-col gap-1">
              {file.provenance.upstream.map(p => p.file && (
                <Card key={p.edgeId} className="p-2 flex items-center gap-2 group">
                  <RelationLabel relation={p.relation} />
                  <FormatPill filename={p.file.filename} />
                  <Link to={`/files/${p.file.id}`} className="no-underline flex-1 min-w-0">
                    <Text variant="mono" className="truncate hover:text-accent transition-colors duration-fast">{p.file.filename}</Text>
                  </Link>
                  {p.file.types.map(t => <Badge key={t} variant="count" color="dim">{t}</Badge>)}
                  <button
                    onClick={() => handleRemoveProvenance(p.edgeId)}
                    disabled={removeProvPending}
                    className={iconAction({ color: 'danger', reveal: true })}
                    title="Remove link"
                  >
                    ×
                  </button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {file.provenance.downstream.length > 0 && (
          <div className="mb-2">
            <Text variant="caption" className="mb-1 block text-text-dim">Files created from this:</Text>
            <div className="flex flex-col gap-1">
              {file.provenance.downstream.map(p => p.file && (
                <Card key={p.edgeId} className="p-2 flex items-center gap-2 group">
                  <RelationLabel relation={p.relation} />
                  <FormatPill filename={p.file.filename} />
                  <Link to={`/files/${p.file.id}`} className="no-underline flex-1 min-w-0">
                    <Text variant="mono" className="truncate hover:text-accent transition-colors duration-fast">{p.file.filename}</Text>
                  </Link>
                  {p.file.types.map(t => <Badge key={t} variant="count" color="dim">{t}</Badge>)}
                  <button
                    onClick={() => handleRemoveProvenance(p.edgeId)}
                    disabled={removeProvPending}
                    className={iconAction({ color: 'danger', reveal: true })}
                    title="Remove link"
                  >
                    ×
                  </button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {file.provenance.upstream.length === 0 && file.provenance.downstream.length === 0 && !addingProv && (
          <Text variant="caption">No data links.</Text>
        )}
      </div>

      {/* External links */}
      <LinksList parentType="file" parentId={fileId!} />
    </div>
  );
}
