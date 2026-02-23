import { useState, useRef, useCallback } from 'react';
import { cx } from 'class-variance-authority';
import { Gigbag } from 'concertina';
import { useOrganismsQuery, useCreateOrganismMutation } from '../hooks/useGenomicQueries';
import { useConfirmDelete } from '../hooks/useConfirmDelete';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { Badge, Text, Heading, Card, InlineInput, inlineInput, iconAction } from '../ui';
import { formatRelativeTime } from '../lib/formats';

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      <td className="py-1.5 pl-2.5 pr-3">
        <div className="flex flex-col gap-1">
          <div className="concertina-warmup-line concertina-warmup-line-long" />
          <div className="concertina-warmup-line concertina-warmup-line-short" />
        </div>
      </td>
      <td className="py-1.5 pl-2.5 pr-3">
        <div className="flex flex-col gap-1">
          <div className="concertina-warmup-line concertina-warmup-line-short" />
          <div className="concertina-warmup-line concertina-warmup-line-short" />
        </div>
      </td>
      <td className="py-1.5 pl-2.5 pr-3 text-right align-top pt-2">
        <div className="concertina-warmup-line concertina-warmup-line-short ml-auto" />
      </td>
      <td className="py-1.5 pl-2.5 pr-3 text-right align-top pt-2">
        <div className="concertina-warmup-line concertina-warmup-line-short ml-auto" />
      </td>
      <td />
    </tr>
  );
}

export default function OrganismsPage() {
  const { data, isLoading, refetch } = useOrganismsQuery();
  const { createOrganism, pending } = useCreateOrganismMutation(refetch);

  const [newGenus, setNewGenus] = useState('');
  const [newSpecies, setNewSpecies] = useState('');
  const genusRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (!newGenus.trim() || !newSpecies.trim()) return;
    await createOrganism({ genus: newGenus.trim(), species: newSpecies.trim() });
    setNewGenus(''); setNewSpecies('');
    genusRef.current?.focus();
  };

  const handleUpdate = async (id: string, patch: Record<string, unknown>) => {
    try {
      const r = await apiFetch(`/api/organisms/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error('Update failed');
      refetch();
    } catch { toast.error('Failed to update organism'); }
  };

  const doDelete = useCallback(async (id: string) => {
    try {
      const r = await apiFetch(`/api/organisms/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error ?? 'Delete failed');
      }
      toast.success('Deleted'); refetch();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to delete organism'); }
  }, [refetch]);
  const { confirmDelete } = useConfirmDelete(doDelete, 'organism');

  const ready = newGenus.trim().length > 0 && newSpecies.trim().length > 0;

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      <div className="shrink-0">
        <Heading level="heading">Organisms</Heading>
        <Text variant="caption">
          {data ? `${data.length} organism${data.length !== 1 ? 's' : ''}` : 'Loading...'}
        </Text>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface">
        <Gigbag className="w-full">
        <table className="w-full border-collapse text-left table-fixed">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="overline">Organism</Text></th>
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="overline">Details</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 text-right w-14"><Text variant="overline">Coll.</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 text-right w-14"><Text variant="overline">Files</Text></th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
              : (
                <>
                  {data?.map(o => (
                    <tr key={o.id} className="border-b border-border-subtle hover:bg-surface transition-colors duration-fast group">
                      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                        <div className="flex items-baseline gap-1 min-w-0">
                          <InlineInput value={o.genus} mono className="italic" onCommit={v => handleUpdate(o.id, { genus: v })} />
                          <InlineInput value={o.species} mono className="font-semibold" onCommit={v => handleUpdate(o.id, { species: v })} />
                        </div>
                        <div className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                          <InlineInput value={o.strain ?? ''} placeholder="strain" mono onCommit={v => handleUpdate(o.id, { strain: v || null })} />
                          <InlineInput value={o.commonName ?? ''} placeholder="common name" onCommit={v => handleUpdate(o.id, { commonName: v || null })} />
                        </div>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                        <InlineInput value={o.referenceGenome ?? ''} placeholder="ref. genome" onCommit={v => handleUpdate(o.id, { referenceGenome: v || null })} />
                        <div className="mt-0.5">
                          <InlineInput value={o.ncbiTaxId?.toString() ?? ''} placeholder="NCBI tax ID" mono onCommit={v => handleUpdate(o.id, { ncbiTaxId: parseInt(v) || null })} />
                        </div>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 text-right align-top pt-2">
                        <Text variant="mono" className="text-text-secondary">{o.collectionCount}</Text>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 text-right align-top pt-2">
                        <Text variant="mono" className="text-text-secondary">{o.fileCount}</Text>
                      </td>
                      <td className="py-1.5 pr-2.5 w-6 align-top pt-2">
                        <button onClick={() => confirmDelete(o.id, `${o.genus} ${o.species}`)}
                          className={iconAction({ color: 'danger', reveal: true })}
                          title="Delete organism">×</button>
                      </td>
                    </tr>
                  ))}

                  {/* Inline add row */}
                  <tr className="text-text-dim">
                    <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                      <div className="flex items-baseline gap-1 min-w-0">
                        <input ref={genusRef} value={newGenus} onChange={e => setNewGenus(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                          placeholder="+ genus"
                          className={cx(inlineInput({ font: 'mono' }), 'italic flex-1 min-w-0')} />
                        <input value={newSpecies} onChange={e => setNewSpecies(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                          placeholder="species"
                          className={cx(inlineInput({ font: 'mono' }), 'font-semibold flex-1 min-w-0')} />
                      </div>
                    </td>
                    <td colSpan={3} />
                    <td className="py-1.5 pr-2.5 w-6">
                      <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${ready ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <button disabled={pending} onClick={handleCreate}
                          className={iconAction({ color: 'accent' })} title="Add">✓</button>
                        <button onClick={() => { setNewGenus(''); setNewSpecies(''); }}
                          className={iconAction({ color: 'dim' })} title="Cancel">×</button>
                      </span>
                    </td>
                  </tr>
                </>
              )}
          </tbody>
        </table>
        </Gigbag>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-1.5 md:hidden flex-1 overflow-auto min-h-0">
        {isLoading
          ? [...Array(4)].map((_, i) => (
            <Card key={i} className="p-2.5 flex flex-col gap-1">
              <div className="concertina-warmup-line concertina-warmup-line-long" />
              <div className="concertina-warmup-line concertina-warmup-line-short" />
            </Card>
          ))
          : !data?.length
            ? <Text variant="body" className="py-8 text-center text-text-dim">No organisms yet.</Text>
            : data.map(o => (
              <Card key={o.id} className="p-2.5 flex flex-col gap-1">
                <Text variant="mono">
                  <span className="text-text-dim italic">{o.genus.charAt(0)}.</span>{' '}
                  <span className="font-semibold">{o.species}</span>
                  {o.strain && <span className="text-text-secondary ml-1">{o.strain}</span>}
                </Text>
                {o.commonName && <Text variant="caption">{o.commonName}</Text>}
                <div className="flex items-center gap-2 flex-wrap">
                  {o.referenceGenome && <Badge variant="count" color="dim">{o.referenceGenome}</Badge>}
                  {o.ncbiTaxId && <Text variant="caption">NCBI: {o.ncbiTaxId}</Text>}
                  <Text variant="caption">{o.collectionCount} coll</Text>
                  <Text variant="caption">{o.fileCount} files</Text>
                  <Text variant="caption">{formatRelativeTime(o.createdAt)}</Text>
                </div>
              </Card>
            ))
        }
      </div>
    </div>
  );
}
