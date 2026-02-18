import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useFileDetailQuery, useFilesQuery, useUpdateFileMutation,
  useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddProvenance, useRemoveProvenance,
  usePresignedUrl, useDeleteFileMutation,
} from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Heading, Text, Card, Badge, Button, InlineInput, Input } from '../ui';
import { CollectionPicker, RelationPicker } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

const RELATION_LABELS: Record<string, string> = {
  derived_from: 'derived from',
  sequenced_from: 'sequenced from',
  produced_by: 'produced by',
};

function RelationLabel({ relation }: { relation: string }) {
  return (
    <span className="font-mono text-micro px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-secondary">
      {RELATION_LABELS[relation] ?? relation.replace(/_/g, ' ')}
    </span>
  );
}

// ── Inline collection chips (same pattern as FilesPage) ──

function InlineCollections({
  fileId, collections, onAdd, onRemove,
}: {
  fileId: string;
  collections: { id: string; name: string; kind: string }[];
  onAdd: (collectionId: string, fileIds: string[]) => Promise<void>;
  onRemove: (collectionId: string, fileIds: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {collections.map(c => (
        <div key={c.id} className="flex items-center gap-1 bg-surface border border-border rounded-sm px-2 py-1 group/chip">
          <Link to={`/collections/${c.id}`} className="no-underline font-mono text-caption text-text hover:text-accent transition-colors duration-fast">
            {c.name}
          </Link>
          <Badge variant="count" color="dim">{c.kind}</Badge>
          <button
            onClick={() => onRemove(c.id, [fileId])}
            className="text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0 text-caption ml-0.5 opacity-0 group-hover/chip:opacity-100 transition-opacity duration-fast"
            title="Remove from collection"
          >
            ×
          </button>
        </div>
      ))}
      {/* Always-visible add trigger — absolute picker overlay */}
      <div className="relative">
        <button
          className={`text-caption text-text-dim hover:text-accent cursor-pointer bg-transparent border-none p-0 font-body transition-colors duration-fast ${adding ? 'invisible' : ''}`}
          onClick={() => setAdding(true)}
        >
          + collection
        </button>
        {adding && (
          <div className="absolute top-1/2 left-0 -translate-y-1/2 z-20">
            <CollectionPicker
              value=""
              onValueChange={v => {
                if (v) onAdd(v, [fileId]);
                setAdding(false);
              }}
              placeholder="Pick collection..."
              variant="surface"
              size="sm"
              className="w-44"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function FileDetailPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const { data: file, isLoading, refetch } = useFileDetailQuery(fileId);
  const { updateFile } = useUpdateFileMutation(refetch);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);
  const { getUrl } = usePresignedUrl();
  const { deleteFile } = useDeleteFileMutation();

  // Collection management
  const { addFiles: addToCol } = useAddFilesToCollection();
  const { removeFiles: removeFromCol } = useRemoveFilesFromCollection();

  // Provenance management
  const [addingProv, setAddingProv] = useState(false);
  const [provSearch, setProvSearch] = useState('');
  const [provRelation, setProvRelation] = useState('derived_from');
  const [provTargetId, setProvTargetId] = useState<string | null>(null);
  const { addProvenance, pending: addProvPending } = useAddProvenance();
  const { removeProvenance, pending: removeProvPending } = useRemoveProvenance();

  // File search for provenance
  const { data: allFiles } = useFilesQuery(addingProv ? {} : undefined as any);

  useEffect(() => {
    if (file && fileId) setBreadcrumbLabel(fileId, file.filename);
  }, [file, fileId, setBreadcrumbLabel]);

  const searchableFiles = useMemo(() => {
    if (!allFiles || !file) return [];
    const q = provSearch.toLowerCase();
    return allFiles
      .filter(f => f.id !== file.id)
      .filter(f => !q || f.filename.toLowerCase().includes(q) || f.kind.toLowerCase().includes(q));
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
        <div className="flex items-center gap-2 mb-1">
          <div className="font-mono text-micro px-1.5 py-0.5 rounded-sm shrink-0 font-bold"
            style={{ background: meta.bg, color: meta.color }}>
            {meta.label}
          </div>
          <Badge variant="count" color="dim">{file.kind}</Badge>
          {file.status === 'ready' && <Badge variant="status" color="green">ready</Badge>}
          {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
          {file.status === 'error' && <Badge variant="status" color="red">error</Badge>}
        </div>
        <Heading level="heading">{file.filename}</Heading>

        {/* Description — inline editable */}
        <div className="mt-0.5">
          <InlineInput
            value={file.description ?? ''}
            placeholder="add description"
            onCommit={v => { if (fileId) updateFile(fileId, { description: v || null }); }}
          />
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Text variant="caption">{formatBytes(file.sizeBytes)}</Text>
          {file.md5 && <Text variant="caption" className="font-mono">MD5: {file.md5.slice(0, 12)}...</Text>}
          {file.organismDisplay && <Text variant="caption" className="italic">{file.organismDisplay}</Text>}
          <Text variant="caption">Uploaded {formatRelativeTime(file.uploadedAt)}</Text>
          {file.uploadedBy && <Text variant="caption">by {file.uploadedBy}</Text>}
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

      {/* Collections — inline chips with + picker */}
      <div>
        <Text variant="overline" className="mb-1.5 block">Collections</Text>
        {file.collections.length === 0 ? (
          <div className="flex items-center gap-1.5">
            <Text variant="caption">Not in any collection.</Text>
            <InlineCollections
              fileId={fileId!}
              collections={[]}
              onAdd={handleAddToCollection}
              onRemove={handleRemoveFromCollection}
            />
          </div>
        ) : (
          <InlineCollections
            fileId={fileId!}
            collections={file.collections}
            onAdd={handleAddToCollection}
            onRemove={handleRemoveFromCollection}
          />
        )}
      </div>

      {/* Data Links */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="overline" className="flex-1">Data Links</Text>
          <button
            onClick={() => { setAddingProv(!addingProv); setProvTargetId(null); setProvSearch(''); }}
            className="text-caption text-text-dim hover:text-accent cursor-pointer bg-transparent border-none p-0 font-body transition-colors duration-fast"
          >
            {addingProv ? '× close' : '+ add link'}
          </button>
        </div>

        {/* Add data link panel */}
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
                  className="text-caption text-accent hover:text-text cursor-pointer bg-transparent border-none p-0 font-body"
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
                  searchableFiles.slice(0, 30).map(f => {
                    const fmtF = detectFormat(f.filename);
                    const metaF = FORMAT_META[fmtF];
                    return (
                      <button
                        key={f.id}
                        onClick={() => { setProvTargetId(f.id); setProvSearch(f.filename); }}
                        className={`flex items-center gap-2 px-1.5 py-1 rounded-sm cursor-pointer border-none text-left w-full transition-colors duration-fast ${
                          provTargetId === f.id ? 'bg-accent/10' : 'bg-transparent hover:bg-surface'
                        }`}
                      >
                        <span className="font-mono text-micro px-1 py-px rounded-sm shrink-0 font-bold"
                          style={{ background: metaF.bg, color: metaF.color }}>
                          {metaF.label}
                        </span>
                        <span className="font-mono text-caption text-text truncate flex-1 min-w-0">{f.filename}</span>
                        <Badge variant="count" color="dim">{f.kind}</Badge>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* Upstream (this file was derived/sequenced/produced from) */}
        {file.provenance.upstream.length > 0 && (
          <div className="mb-2">
            <Text variant="caption" className="mb-1 block text-text-dim">This file was created from:</Text>
            <div className="flex flex-col gap-1">
              {file.provenance.upstream.map(p => p.file && (
                <Card key={p.edgeId} className="p-2 flex items-center gap-2 group">
                  <RelationLabel relation={p.relation} />
                  <div className="font-mono text-micro px-1 py-px rounded-sm shrink-0 font-bold"
                    style={{ background: FORMAT_META[detectFormat(p.file.filename)]?.bg, color: FORMAT_META[detectFormat(p.file.filename)]?.color }}>
                    {FORMAT_META[detectFormat(p.file.filename)]?.label}
                  </div>
                  <Link to={`/files/${p.file.id}`} className="no-underline font-mono text-caption text-text truncate flex-1 min-w-0 hover:text-accent transition-colors duration-fast">
                    {p.file.filename}
                  </Link>
                  <Badge variant="count" color="dim">{p.file.kind}</Badge>
                  <button
                    onClick={() => handleRemoveProvenance(p.edgeId)}
                    disabled={removeProvPending}
                    className="shrink-0 text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0.5 text-caption opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                    title="Remove link"
                  >
                    ×
                  </button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Downstream (other files created from this one) */}
        {file.provenance.downstream.length > 0 && (
          <div className="mb-2">
            <Text variant="caption" className="mb-1 block text-text-dim">Files created from this:</Text>
            <div className="flex flex-col gap-1">
              {file.provenance.downstream.map(p => p.file && (
                <Card key={p.edgeId} className="p-2 flex items-center gap-2 group">
                  <RelationLabel relation={p.relation} />
                  <div className="font-mono text-micro px-1 py-px rounded-sm shrink-0 font-bold"
                    style={{ background: FORMAT_META[detectFormat(p.file.filename)]?.bg, color: FORMAT_META[detectFormat(p.file.filename)]?.color }}>
                    {FORMAT_META[detectFormat(p.file.filename)]?.label}
                  </div>
                  <Link to={`/files/${p.file.id}`} className="no-underline font-mono text-caption text-text truncate flex-1 min-w-0 hover:text-accent transition-colors duration-fast">
                    {p.file.filename}
                  </Link>
                  <Badge variant="count" color="dim">{p.file.kind}</Badge>
                  <button
                    onClick={() => handleRemoveProvenance(p.edgeId)}
                    disabled={removeProvPending}
                    className="shrink-0 text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0.5 text-caption opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
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
