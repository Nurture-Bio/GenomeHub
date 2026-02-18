import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useCollectionDetailQuery, useFilesQuery,
  useUpdateCollectionMutation,
  useAddFilesToCollection, useRemoveFilesFromCollection,
} from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, formatBytes } from '../lib/formats';
import { Heading, Text, Badge, InlineInput, Input } from '../ui';
import { TechniquePicker, OrganismPicker } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

export default function CollectionDetailPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { data: collection, isLoading, refetch } = useCollectionDetailQuery(collectionId);
  const { updateCollection } = useUpdateCollectionMutation(refetch);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  const [addSearch, setAddSearch] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const { addFiles, pending: addPending } = useAddFilesToCollection();
  const { removeFiles, pending: removePending } = useRemoveFilesFromCollection();

  // Only load all files when user is searching to add
  const [showAddPanel, setShowAddPanel] = useState(false);
  const { data: allFiles } = useFilesQuery(showAddPanel ? {} : undefined as any);

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
    setShowAddPanel(false);
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
      {/* Header — inline editable */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <TechniquePicker
            value={collection.technique?.id ?? ''}
            onValueChange={v => { if (collectionId) updateCollection(collectionId, { techniqueId: v || undefined }); }}
            variant="surface" size="sm" className="w-36"
          />
          <Badge variant="count" color="dim">{collection.kind}</Badge>
        </div>

        {/* Name — inline editable */}
        <InlineInput
          value={collection.name}
          mono
          className="text-heading font-semibold"
          onCommit={v => { if (collectionId && v) updateCollection(collectionId, { name: v }); }}
        />

        {/* Description — inline editable */}
        <div className="mt-0.5">
          <InlineInput
            value={collection.description ?? ''}
            placeholder="add description"
            onCommit={v => { if (collectionId) updateCollection(collectionId, { description: v }); }}
          />
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <OrganismPicker
            value={collection.organismId ?? ''}
            onValueChange={v => { if (collectionId) updateCollection(collectionId, { organismId: v || undefined }); }}
            variant="surface" size="sm" className="w-40"
          />
          <Badge variant="count" color="accent">{collection.fileCount} files</Badge>
        </div>
      </div>

      {/* Files (playlist contents) */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="overline" className="flex-1">Files</Text>
          <button
            onClick={() => { setShowAddPanel(!showAddPanel); setAddSelected(new Set()); setAddSearch(''); }}
            className="text-caption text-text-dim hover:text-accent cursor-pointer bg-transparent border-none p-0 font-body transition-colors duration-fast"
          >
            {showAddPanel ? '× close' : '+ add files'}
          </button>
        </div>

        {/* Add files panel — minimal shift: fixed height search + scrollable list */}
        {showAddPanel && (
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
              <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${addSelected.size > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <button
                  disabled={addPending}
                  onClick={handleAddFiles}
                  className="text-caption text-accent hover:text-text cursor-pointer bg-transparent border-none p-0 font-body"
                  title={`Add ${addSelected.size}`}
                >
                  ✓ {addSelected.size}
                </button>
              </span>
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
        {collection.files.length === 0 && !showAddPanel ? (
          <Text variant="caption">No files yet. Click "+ add files" above.</Text>
        ) : (
          <div className="border border-border rounded-md bg-surface overflow-hidden">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="py-1.5 pl-2.5 pr-3 font-body text-micro uppercase tracking-overline text-text-dim font-semibold">File</th>
                  <th className="py-1.5 pr-3 font-body text-micro uppercase tracking-overline text-text-dim font-semibold w-24">Kind</th>
                  <th className="py-1.5 pr-3 font-body text-micro uppercase tracking-overline text-text-dim font-semibold text-right w-20">Size</th>
                  <th className="py-1.5 pr-3 font-body text-micro uppercase tracking-overline text-text-dim font-semibold w-20">Status</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {collection.files.map(file => {
                  const fmt = detectFormat(file.filename);
                  const meta = FORMAT_META[fmt];
                  return (
                    <tr key={file.id} className="border-b border-border-subtle hover:bg-surface transition-colors duration-fast group">
                      <td className="py-1.5 pl-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-micro px-1.5 py-0.5 rounded-sm shrink-0 font-bold"
                            style={{ background: meta.bg, color: meta.color }}>
                            {meta.label}
                          </div>
                          <Link to={`/files/${file.id}`} className="no-underline font-mono text-caption text-text truncate hover:text-accent transition-colors duration-fast">
                            {file.filename}
                          </Link>
                        </div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge variant="count" color="dim">{file.kind}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary text-right">
                        {formatBytes(file.sizeBytes)}
                      </td>
                      <td className="py-1.5 pr-3">
                        {file.status === 'ready' && <Badge variant="status" color="green">ready</Badge>}
                        {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
                        {file.status === 'error' && <Badge variant="status" color="red">error</Badge>}
                      </td>
                      <td className="py-1.5 pr-2.5">
                        <button
                          onClick={() => handleRemoveFile(file.id)}
                          disabled={removePending}
                          className="text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0 text-caption opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                          title="Remove from collection"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Links */}
      <LinksList parentType="collection" parentId={collectionId!} />
    </div>
  );
}
