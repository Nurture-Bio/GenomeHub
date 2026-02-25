import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useCollectionDetailQuery, useFilesQuery,
  useUpdateCollectionMutation,
  useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddCollectionOrganism, useRemoveCollectionOrganism,
  useAddCollectionTechnique, useRemoveCollectionTechnique,
} from '../hooks/useGenomicQueries';
import { Glide } from 'concertina';
import { detectFormat, FORMAT_META, formatBytes } from '../lib/formats';
import { Heading, Text, Badge, InlineInput, Input, ChipEditor, HashPill, iconAction } from '../ui';
import { TechniquePicker, OrganismPicker, FileTypePicker } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

export default function CollectionDetailPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { data: collection, isLoading } = useCollectionDetailQuery(collectionId);
  const { updateCollection } = useUpdateCollectionMutation();
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);
  const { addCollectionOrganism } = useAddCollectionOrganism();
  const { removeCollectionOrganism } = useRemoveCollectionOrganism();
  const { addCollectionTechnique } = useAddCollectionTechnique();
  const { removeCollectionTechnique } = useRemoveCollectionTechnique();

  const [addSearch, setAddSearch] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const { addFiles, pending: addPending } = useAddFilesToCollection();
  const { removeFiles, pending: removePending } = useRemoveFilesFromCollection();

  // Only load all files when user is searching to add
  const [showAddPanel, setShowAddPanel] = useState(false);
  const { data: allFiles } = useFilesQuery(showAddPanel ? {} : false);

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
        || f.types.some(t => t.toLowerCase().includes(q))
        || f.organisms.some(o => o.displayName.toLowerCase().includes(q)));
  }, [allFiles, collection, addSearch]);

  const handleAddFiles = async () => {
    if (!collectionId || addSelected.size === 0) return;
    await addFiles(collectionId, [...addSelected]);
    setAddSelected(new Set());
    setShowAddPanel(false);
    setAddSearch('');
  };

  const handleRemoveFile = async (fileId: string) => {
    if (!collectionId) return;
    await removeFiles(collectionId, [fileId]);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <div className="concertina-warmup-line concertina-warmup-line-long" style={{ height: 'var(--font-size-heading)' }} />
        <div className="concertina-warmup-line concertina-warmup-line-short" />
        <div className="flex flex-col gap-1">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="py-1.5 border-b border-line">
              <div className="concertina-warmup-line concertina-warmup-line-long" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <Heading level="heading">Collection not found</Heading>
        <Text variant="dim">The collection may have been deleted.</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3">
      {/* Header — inline editable */}
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <ChipEditor
            items={collection.techniques.map(t => ({ id: t.id, label: t.name }))}
            onAdd={id => { if (collectionId) addCollectionTechnique(collectionId, id); }}
            onRemove={id => { if (collectionId) removeCollectionTechnique(collectionId, id); }}
            renderPicker={p => <TechniquePicker {...p} variant="surface" size="sm" className="w-36" />}
          />
          <ChipEditor
            items={collection.types.map(t => ({ id: t, label: t }))}
            onAdd={id => { if (collectionId) updateCollection(collectionId, { types: [...collection.types, id] }); }}
            onRemove={id => { if (collectionId) updateCollection(collectionId, { types: collection.types.filter(t => t !== id) }); }}
            renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
          />
        </div>

        <InlineInput
          value={collection.name}
          className="text-heading font-semibold"
          onCommit={v => { if (collectionId && v) updateCollection(collectionId, { name: v }); }}
        />

        <div className="mt-0.5">
          <InlineInput
            value={collection.description ?? ''}
            placeholder="add description"
            onCommit={v => { if (collectionId) updateCollection(collectionId, { description: v }); }}
          />
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <ChipEditor
            items={collection.organisms.map(o => ({ id: o.id, label: o.displayName }))}
            onAdd={id => { if (collectionId) addCollectionOrganism(collectionId, id); }}
            onRemove={id => { if (collectionId) removeCollectionOrganism(collectionId, id); }}
            renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-40" />}
          />
          <Badge variant="count" color="accent">{collection.fileCount} files</Badge>
        </div>
      </div>

      {/* Files (playlist contents) */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="muted" className="flex-1">Files</Text>
          <button
            onClick={() => { setShowAddPanel(!showAddPanel); setAddSelected(new Set()); setAddSearch(''); }}
            className={iconAction({ color: 'dim' })}
          >
            {showAddPanel ? '× close' : '+ add files'}
          </button>
        </div>

        {/* Add files panel */}
        <Glide show={showAddPanel}>
          <div className="border border-line rounded-md p-2.5 mb-2 bg-raised">
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
                  className={iconAction({ color: 'accent' })}
                  title={`Add ${addSelected.size}`}
                >
                  ✓ {addSelected.size}
                </button>
              </span>
            </div>
            <div className="max-h-48 overflow-auto flex flex-col gap-0.5">
              {availableFiles.length === 0 ? (
                <Text variant="dim" className="py-2 text-center">
                  {addSearch ? 'No matching files.' : 'No files available to add.'}
                </Text>
              ) : (
                availableFiles.slice(0, 50).map(file => {
                  const fmt = detectFormat(file.filename);
                  const meta = FORMAT_META[fmt];
                  const checked = addSelected.has(file.id);
                  return (
                    <label key={file.id} className="flex items-center gap-2 px-1.5 py-1 rounded-sm cursor-pointer hover:bg-base transition-colors duration-fast">
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
                        className="accent-cyan shrink-0"
                      />
                      <HashPill label={meta.label} colorKey={fmt} />
                      <Text variant="mono" className="truncate flex-1 min-w-0">{file.filename}</Text>
                      {file.types.map(t => <HashPill key={t} label={t} />)}
                      <Text variant="dim" className="shrink-0">{formatBytes(file.sizeBytes)}</Text>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </Glide>

        {/* Existing files */}
        {collection.files.length === 0 && !showAddPanel ? (
          <Text variant="dim">No files yet. Click "+ add files" above.</Text>
        ) : (
          <div className="border border-line rounded-md bg-base overflow-hidden">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-raised">
                  <th className="py-1.5 pl-2.5 pr-3"><Text variant="muted">File</Text></th>
                  <th className="py-1.5 pr-3 w-24"><Text variant="muted">Type</Text></th>
                  <th className="py-1.5 pr-3 text-right w-20"><Text variant="muted">Size</Text></th>
                  <th className="py-1.5 pr-3 w-20"><Text variant="muted">Status</Text></th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {collection.files.map(file => {
                  const fmt = detectFormat(file.filename);
                  const meta = FORMAT_META[fmt];
                  return (
                    <tr key={file.id} className="border-b border-line hover:bg-base transition-colors duration-fast group">
                      <td className="py-1.5 pl-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <HashPill label={meta.label} colorKey={fmt} />
                          <Link to={`/files/${file.id}`} className="no-underline">
                            <Text variant="mono" className="truncate hover:text-cyan transition-colors duration-fast">
                              {file.filename}
                            </Text>
                          </Link>
                        </div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex gap-0.5 flex-wrap">
                          {file.types.map(t => <HashPill key={t} label={t} />)}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <Text variant="dim" className="tabular-nums">{formatBytes(file.sizeBytes)}</Text>
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
                          className={iconAction({ color: 'danger', reveal: true })}
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
