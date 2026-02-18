import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useCollectionDetailQuery, useFilesQuery,
  useAddFilesToCollection, useRemoveFilesFromCollection,
} from '../hooks/useGenomicQueries';
import { TechniquePill } from '../lib/techniqueColors';
import { detectFormat, FORMAT_META, formatBytes } from '../lib/formats';
import { Heading, Text, Card, Badge, Button, Input } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

export default function CollectionDetailPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { data: collection, isLoading, refetch } = useCollectionDetailQuery(collectionId);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  const [addingFiles, setAddingFiles] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const { addFiles, pending: addPending } = useAddFilesToCollection();
  const { removeFiles, pending: removePending } = useRemoveFilesFromCollection();

  // Load all files for the "add files" panel
  const { data: allFiles } = useFilesQuery(addingFiles ? {} : undefined as any);

  useEffect(() => {
    if (collection && collectionId) setBreadcrumbLabel(collectionId, collection.name);
  }, [collection, collectionId, setBreadcrumbLabel]);

  // Files available to add (not already in this collection)
  const availableFiles = useMemo(() => {
    if (!allFiles || !collection) return [];
    const existingIds = new Set(collection.files.map(f => f.id));
    const q = addSearch.toLowerCase();
    return allFiles
      .filter(f => !existingIds.has(f.id))
      .filter(f => !q || f.filename.toLowerCase().includes(q)
        || f.kind.toLowerCase().includes(q)
        || (f.organismDisplay?.toLowerCase().includes(q) ?? false));
  }, [allFiles, collection, addSearch]);

  const handleAddFiles = async () => {
    if (!collectionId || addSelected.size === 0) return;
    await addFiles(collectionId, [...addSelected]);
    setAddSelected(new Set());
    setAddingFiles(false);
    setAddSearch('');
    refetch();
  };

  const handleRemoveFile = async (fileId: string) => {
    if (!collectionId) return;
    await removeFiles(collectionId, [fileId]);
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <div className="skeleton h-6 w-48 rounded-sm" />
        <div className="skeleton h-4 w-72 rounded-sm" />
        <div className="flex flex-col gap-1">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-10 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <Heading level="heading">Collection not found</Heading>
        <Text variant="caption">The collection may have been deleted.</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          {collection.technique?.name && (
            <TechniquePill name={collection.technique.name} />
          )}
          <Badge variant="count" color="dim">{collection.kind}</Badge>
        </div>
        <Heading level="heading">{collection.name}</Heading>
        {collection.description && <Text variant="caption">{collection.description}</Text>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {collection.organismDisplay && <Text variant="caption" className="italic">{collection.organismDisplay}</Text>}
          <Badge variant="count" color="accent">{collection.fileCount} files</Badge>
        </div>
      </div>

      {/* Files (playlist contents) */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="overline" className="flex-1">Files</Text>
          <Button
            intent="ghost"
            size="sm"
            onClick={() => { setAddingFiles(!addingFiles); setAddSelected(new Set()); setAddSearch(''); }}
          >
            {addingFiles ? 'Cancel' : 'Add files'}
          </Button>
        </div>

        {/* Add files panel */}
        {addingFiles && (
          <div className="border border-border rounded-md p-2.5 mb-2 bg-surface-2">
            <div className="flex items-center gap-2 mb-2">
              <Input
                variant="surface"
                size="sm"
                placeholder="Search files..."
                value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                className="flex-1"
              />
              <Button
                intent="primary"
                size="sm"
                pending={addPending}
                disabled={addSelected.size === 0}
                onClick={handleAddFiles}
              >
                Add {addSelected.size > 0 ? addSelected.size : ''}
              </Button>
            </div>
            <div className="max-h-48 overflow-auto flex flex-col gap-0.5">
              {availableFiles.length === 0 ? (
                <Text variant="caption" className="py-2 text-center">
                  {addSearch ? 'No matching files.' : 'No files available to add.'}
                </Text>
              ) : (
                availableFiles.slice(0, 50).map(file => {
                  const fmt = detectFormat(file.filename);
                  const meta = FORMAT_META[fmt];
                  const checked = addSelected.has(file.id);
                  return (
                    <label key={file.id} className="flex items-center gap-2 px-1.5 py-1 rounded-sm cursor-pointer hover:bg-surface transition-colors duration-fast">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          setAddSelected(prev => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(file.id) : next.delete(file.id);
                            return next;
                          });
                        }}
                        className="accent-accent shrink-0"
                      />
                      <span className="font-mono text-micro px-1 py-px rounded-sm shrink-0 font-bold"
                        style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className="font-mono text-caption text-text truncate flex-1 min-w-0">{file.filename}</span>
                      <Badge variant="count" color="dim">{file.kind}</Badge>
                      <Text variant="caption" className="shrink-0">{formatBytes(file.sizeBytes)}</Text>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Existing files */}
        {collection.files.length === 0 && !addingFiles ? (
          <Text variant="caption">No files yet. Click "Add files" to add files to this collection.</Text>
        ) : (
          <div className="flex flex-col gap-1">
            {collection.files.map(file => {
              const fmt = detectFormat(file.filename);
              const meta = FORMAT_META[fmt];
              return (
                <Card key={file.id} className="p-2 flex items-center gap-2">
                  <div className="font-mono text-micro px-1.5 py-0.5 rounded-sm shrink-0 font-bold"
                    style={{ background: meta.bg, color: meta.color }}>
                    {meta.label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link to={`/files/${file.id}`} className="no-underline font-mono text-caption text-text truncate block hover:text-accent transition-colors duration-fast">
                      {file.filename}
                    </Link>
                  </div>
                  <Badge variant="count" color="dim">{file.kind}</Badge>
                  <Text variant="caption" className="shrink-0">{formatBytes(file.sizeBytes)}</Text>
                  {file.status === 'ready' && <Badge variant="status" color="green">ready</Badge>}
                  {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
                  {file.status === 'error' && <Badge variant="status" color="red">error</Badge>}
                  <button
                    onClick={() => handleRemoveFile(file.id)}
                    disabled={removePending}
                    className="shrink-0 text-text-dim hover:text-red cursor-pointer bg-transparent border-none p-0.5 text-caption opacity-0 group-hover:opacity-100"
                    title="Remove from collection"
                  >
                    ×
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Links */}
      <LinksList parentType="collection" parentId={collectionId!} />
    </div>
  );
}
