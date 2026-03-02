import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useFileDetailQuery, useFilesQuery, useUpdateFileMutation,
  useAddFilesToCollection, useRemoveFilesFromCollection,
  useAddProvenance, useRemoveProvenance,
  usePresignedUrl, useDeleteFileMutation,
  useAddFileOrganism, useRemoveFileOrganism,
  type GenomicFile,
} from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime, isConvertible } from '../lib/formats';
import { Heading, Text, Card, Badge, InlineInput, Input, ChipEditor, HashChip, iconAction, Stepper } from '../ui';
import type { StepperStep } from '../ui';
import { CollectionPicker, OrganismPicker, FileTypePicker, RelationPicker } from '../ui';
import LinksList from '../components/LinksList';
import FilePreview from '../components/FilePreview';
import ParquetPreview from '../components/ParquetPreview';
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
  return <HashChip label={meta.label} colorKey={fmt} />;
}

export default function FileDetailPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const queryClient = useQueryClient();

  // ── Synchronous list-cache lookup ────────────────────────────
  // Pull file metadata from any cached useFilesQuery response.
  // Resolves in 0ms after navigating from the file list.
  const cachedFile = useMemo(() => {
    if (!fileId) return null;
    const queries = queryClient.getQueriesData<GenomicFile[]>({
      queryKey: ['files', 'list'],
    });
    for (const [, files] of queries) {
      if (!files) continue;
      const found = files.find(f => f.id === fileId);
      if (found) return found;
    }
    return null;
  }, [fileId, queryClient]);

  // Detail query — provides provenance + links.
  // Runs in background; does NOT gate preview or metadata render.
  const { data: fileDetail } = useFileDetailQuery(fileId);

  // Prefer detail (richer), fall back to list cache
  const file = fileDetail ?? cachedFile;

  const { updateFile } = useUpdateFileMutation();
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);
  const { getUrl } = usePresignedUrl();
  const { deleteFile } = useDeleteFileMutation();

  const { addFiles: addToCol } = useAddFilesToCollection();
  const { removeFiles: removeFromCol } = useRemoveFilesFromCollection();
  const { addFileOrganism } = useAddFileOrganism();
  const { removeFileOrganism } = useRemoveFileOrganism();

  // Generic stepper state — any preview type can populate this via onProgress
  const [stepperConfig, setStepperConfig] = useState<{
    steps: StepperStep[];
    active: number;
  } | null>(null);

  const [addingProv, setAddingProv] = useState(false);
  const [provSearch, setProvSearch] = useState('');
  const [provRelation, setProvRelation] = useState('derived_from');
  const [provTargetId, setProvTargetId] = useState<string | null>(null);
  const { addProvenance, pending: addProvPending } = useAddProvenance();
  const { removeProvenance, pending: removeProvPending } = useRemoveProvenance();

  const { data: allFiles } = useFilesQuery(addingProv ? {} : false);

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
  };

  const handleRemoveFromCollection = async (collectionId: string, fileIds: string[]) => {
    await removeFromCol(collectionId, fileIds);
  };

  const handleAddProvenance = async () => {
    if (!fileId || !provTargetId) return;
    await addProvenance(fileId, provTargetId, provRelation);
    setProvTargetId(null);
    setProvSearch('');
    setAddingProv(false);
  };

  const handleRemoveProvenance = async (edgeId: string) => {
    if (!fileId) return;
    await removeProvenance(fileId, edgeId);
  };

  const handleDownload = async () => {
    if (!fileId) return;
    const url = await getUrl(fileId);
    window.open(url, '_blank');
  };

  if (!file && !fileId) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-5">
        <Heading level="heading">File not found</Heading>
        <Text variant="dim">The file may have been deleted.</Text>
      </div>
    );
  }

  const fmt = file ? detectFormat(file.filename) : null;
  const meta = fmt ? FORMAT_META[fmt] : null;

  return (
    <div className="flex flex-col gap-3 md:gap-4 p-2 md:p-5 animate-page-enter">

      {/* Pipeline stepper — populated by preview components via onProgress */}
      {stepperConfig && (
        <div className="flex justify-center w-full">
          <Stepper steps={stepperConfig.steps} active={stepperConfig.active} />
        </div>
      )}

      {/* Title row */}
      <div className="flex items-center gap-2 flex-wrap">
        {file && <HashChip label={meta!.label} colorKey={fmt!} />}
        <Heading level="heading">{file ? file.filename : '\u00A0'}</Heading>
        {file && (
          <HashChip
            label="export"
            onClick={handleDownload}
            style={{ '--hc-bg': 'transparent', '--hc-fg': 'var(--color-fg-3)', '--hc-border': 'var(--color-line)' } as React.CSSProperties}
          />
        )}
      </div>

      {/* File preview — ParquetPreview always mounts once with fileId.
           FilePreview only renders for non-convertible files (plain text). */}
      {file && !isConvertible(file.filename) ? (
        <FilePreview fileId={fileId!} filename={file.filename} sizeBytes={file.sizeBytes} />
      ) : (
        <ParquetPreview fileId={fileId!} onProgress={setStepperConfig} />
      )}

      {/* Metadata — below the data where it belongs */}
      {file ? (
        <div className="flex flex-col gap-2">
          <div className="mt-0.5">
            <InlineInput
              value={file.description ?? ''}
              placeholder="add description"
              onCommit={v => { if (fileId) updateFile(fileId, { description: v || null }); }}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Text variant="dim">{formatBytes(file.sizeBytes)}</Text>
            {file.md5 && <Text variant="dim">MD5: {file.md5.slice(0, 12)}...</Text>}
            <Text variant="dim">Uploaded {formatRelativeTime(file.uploadedAt)}</Text>
            {file.uploadedBy && <Text variant="dim">by {file.uploadedBy}</Text>}
          </div>

          <div className="flex items-center gap-2">
            <Text variant="dim" className="shrink-0">Organisms:</Text>
            <ChipEditor
              items={file.organisms.map(o => ({ id: o.id, label: o.displayName }))}
              onAdd={id => { if (fileId) addFileOrganism(fileId, id); }}
              onRemove={id => { if (fileId) removeFileOrganism(fileId, id); }}
              renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-40" />}
            />
          </div>

          <div className="flex items-center gap-2">
            <Text variant="dim" className="shrink-0">Types:</Text>
            <ChipEditor
              items={file.types.map(t => ({ id: t, label: t }))}
              onAdd={id => { if (fileId) updateFile(fileId, { types: [...file.types, id] }); }}
              onRemove={id => { if (fileId) updateFile(fileId, { types: file.types.filter(t => t !== id) }); }}
              renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
            />
          </div>

          {file.tags.length > 0 && (
            <div className="flex gap-0.5 flex-wrap">
              {file.tags.map(t => <Badge key={t} variant="count" color="dim">{t}</Badge>)}
            </div>
          )}
        </div>
      ) : null}

      {/* Collections */}
      {file && (
      <div>
        <Text variant="muted" className="mb-1.5 block">Collections</Text>
        <ChipEditor
          items={file.collections.map(c => ({ id: c.id, label: c.name ?? '' }))}
          onAdd={id => handleAddToCollection(id, [fileId!])}
          onRemove={id => handleRemoveFromCollection(id, [fileId!])}
          renderPicker={p => <CollectionPicker {...p} variant="surface" size="sm" className="w-44" />}
          renderLabel={item => (
            <Link to={`/collections/${item.id}`} className="no-underline text-fg-2 hover:text-cyan">
              {item.label}
            </Link>
          )}
        />
      </div>
      )}

      {/* Data Links — only render once file metadata is loaded */}
      {file && (
      <>
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Text variant="muted" className="flex-1">Data Links</Text>
          <button
            onClick={() => { setAddingProv(!addingProv); setProvTargetId(null); setProvSearch(''); }}
            className={iconAction({ color: 'dim' })}
          >
            {addingProv ? '× close' : '+ add link'}
          </button>
        </div>

        {addingProv && (
          <div className="border border-line rounded-md p-2.5 mb-2 bg-raised">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Text variant="dim" className="shrink-0">This file</Text>
              <RelationPicker
                value={provRelation}
                onValueChange={setProvRelation}
                placeholder="Relation"
                variant="surface"
                size="sm"
                className="w-40"
              />
              <Text variant="dim" className="shrink-0">→</Text>
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
                  <Text variant="dim" className="py-2 text-center">No matching files.</Text>
                ) : (
                  searchableFiles.slice(0, 30).map(f => (
                    <button
                      key={f.id}
                      onClick={() => { setProvTargetId(f.id); setProvSearch(f.filename); }}
                      className={`flex items-center gap-2 px-1.5 py-1 rounded-sm cursor-pointer border-none text-left w-full transition-colors duration-fast ${
                        provTargetId === f.id ? 'bg-cyan/10' : 'bg-transparent hover:bg-base'
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

        {fileDetail && fileDetail.provenance.upstream.length > 0 && (
          <div className="mb-2">
            <Text variant="dim" className="mb-1 block text-fg-3">This file was created from:</Text>
            <div className="flex flex-col gap-1">
              {fileDetail.provenance.upstream.map(p => p.file && (
                <Card key={p.edgeId} className="p-2 flex items-center gap-2 group">
                  <RelationLabel relation={p.relation} />
                  <FormatPill filename={p.file.filename} />
                  <Link to={`/files/${p.file.id}`} className="no-underline flex-1 min-w-0">
                    <Text variant="mono" className="truncate hover:text-cyan transition-colors duration-fast">{p.file.filename}</Text>
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

        {fileDetail && fileDetail.provenance.downstream.length > 0 && (
          <div className="mb-2">
            <Text variant="dim" className="mb-1 block text-fg-3">Files created from this:</Text>
            <div className="flex flex-col gap-1">
              {fileDetail.provenance.downstream.map(p => p.file && (
                <Card key={p.edgeId} className="p-2 flex items-center gap-2 group">
                  <RelationLabel relation={p.relation} />
                  <FormatPill filename={p.file.filename} />
                  <Link to={`/files/${p.file.id}`} className="no-underline flex-1 min-w-0">
                    <Text variant="mono" className="truncate hover:text-cyan transition-colors duration-fast">{p.file.filename}</Text>
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

        {fileDetail && fileDetail.provenance.upstream.length === 0 && fileDetail.provenance.downstream.length === 0 && !addingProv && (
          <Text variant="dim" className="animate-fade-up">No data links.</Text>
        )}
      </div>

      {/* External links */}
      <LinksList parentType="file" parentId={fileId!} />
      </>
      )}
    </div>
  );
}
