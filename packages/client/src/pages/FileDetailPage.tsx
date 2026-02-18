import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useFileDetailQuery, useFilesQuery,
  useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddProvenance, useRemoveProvenance,
  usePresignedUrl, useDeleteFileMutation,
} from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Heading, Text, Card, Badge, Button, Input } from '../ui';
import { CollectionPicker } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

const PROVENANCE_LABELS: Record<string, string> = {
  derived_from: 'Derived from',
  sequenced_from: 'Sequenced from',
  produced_by: 'Produced by',
};

function ProvenanceRelationLabel({ relation }: { relation: string }) {
  return (
    <span className="font-mono text-micro px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-secondary">
      {PROVENANCE_LABELS[relation] ?? relation}
    </span>
  );
}

export default function FileDetailPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const { data: file, isLoading, refetch } = useFileDetailQuery(fileId);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);
  const { getUrl } = usePresignedUrl();
  const { deleteFile } = useDeleteFileMutation();

  // Collection management
  const [addColId, setAddColId] = useState<string | null>(null);
  const { addFiles: addToCol, pending: addColPending } = useAddFilesToCollection();
  const { removeFiles: removeFromCol, pending: removeColPending } = useRemoveFilesFromCollection();

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

  const handleAddToCollection = async (collectionId: string) => {
    if (!fileId || !collectionId) return;
    await addToCol(collectionId, [fileId]);
    setAddColId(null);
    refetch();
  };

  const handleRemoveFromCollection = async (collectionId: string) => {
    if (!fileId) return;
    await removeFromCol(collectionId, [fileId]);
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
        {file.description && <Text variant="caption">{file.description}</Text>}
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

      {/* Collections */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="overline" className="flex-1">Collections</Text>
          {addColId === null ? (
            <Button intent="ghost" size="sm" onClick={() => setAddColId('')}>Add to collection</Button>
          ) : (
            <div className="flex items-center gap-1">
              <CollectionPicker
                value={addColId}
                onValueChange={handleAddToCollection}
                placeholder="Pick collection..."
                variant="surface"
                size="sm"
                className="w-44"
              />
              <Button intent="ghost" size="sm" onClick={() => setAddColId(null)}>Cancel</Button>
            </div>
          )}
        </div>
        {file.collections.length === 0 ? (
          <Text variant="caption">Not in any collection.</Text>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {file.collections.map(c => (
              <div key={c.id} className="flex items-center gap-1 bg-surface border border-border rounded-sm px-2 py-1">
                <Link to={`/collections/${c.id}`} className="no-underline font-mono text-caption text-text hover:text-accent transition-colors duration-fast">
                  {c.name}
                </Link>
                <Badge variant="count" color="dim">{c.kind}</Badge>
                <button
                  onClick={() => handleRemoveFromCollection(c.id)}
                  disabled={removeColPending}
                  className="text-text-dim hover:text-red cursor-pointer bg-transparent border-none p-0 text-caption ml-1"
                  title="Remove from collection"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Projects */}
      {file.projects.length > 0 && (
        <div>
          <Text variant="overline" className="mb-1.5 block">Projects</Text>
          <div className="flex items-center gap-1.5 flex-wrap">
            {file.projects.map(p => (
              <Link key={p.id} to={`/projects/${p.id}`} className="no-underline">
                <Badge variant="count" color="dim">{p.name}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Provenance */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="overline" className="flex-1">Provenance</Text>
          <Button
            intent="ghost"
            size="sm"
            onClick={() => { setAddingProv(!addingProv); setProvTargetId(null); setProvSearch(''); }}
          >
            {addingProv ? 'Cancel' : 'Add link'}
          </Button>
        </div>

        {/* Add provenance panel */}
        {addingProv && (
          <div className="border border-border rounded-md p-2.5 mb-2 bg-surface-2">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Text variant="caption" className="shrink-0">This file</Text>
              <select
                value={provRelation}
                onChange={e => setProvRelation(e.target.value)}
                className="font-body text-caption bg-surface border border-border rounded-sm px-1.5 py-1 cursor-pointer"
              >
                <option value="derived_from">derived from</option>
                <option value="sequenced_from">sequenced from</option>
                <option value="produced_by">produced by</option>
              </select>
              <Text variant="caption" className="shrink-0">→</Text>
              <Input
                variant="surface"
                size="sm"
                placeholder="Search files..."
                value={provSearch}
                onChange={e => { setProvSearch(e.target.value); setProvTargetId(null); }}
                className="flex-1 min-w-32"
              />
              <Button
                intent="primary"
                size="sm"
                pending={addProvPending}
                disabled={!provTargetId}
                onClick={handleAddProvenance}
              >
                Add
              </Button>
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
                <Card key={p.edgeId} className="p-2 flex items-center gap-2">
                  <ProvenanceRelationLabel relation={p.relation} />
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
                    className="shrink-0 text-text-dim hover:text-red cursor-pointer bg-transparent border-none p-0.5 text-caption"
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
                <Card key={p.edgeId} className="p-2 flex items-center gap-2">
                  <ProvenanceRelationLabel relation={p.relation} />
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
                    className="shrink-0 text-text-dim hover:text-red cursor-pointer bg-transparent border-none p-0.5 text-caption"
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
          <Text variant="caption">No provenance links. Click "Add link" to connect related files.</Text>
        )}
      </div>

      {/* External links */}
      <LinksList parentType="file" parentId={fileId!} />
    </div>
  );
}
