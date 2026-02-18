import { useState, useRef } from 'react';
import { useOrganismsQuery, useCreateOrganismMutation } from '../hooks/useGenomicQueries';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { Badge, Text, Heading, Card, InlineInput } from '../ui';
import { formatRelativeTime } from '../lib/formats';

const TH = 'py-1.5 pr-3 pl-2.5 font-body text-micro uppercase tracking-overline text-text-dim font-semibold whitespace-nowrap';

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(5)].map((_, i) => (
        <td key={i} className="py-2 pr-3 pl-2.5">
          <div className="skeleton h-4 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
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

  const handleDelete = async (id: string) => {
    try {
      const r = await apiFetch(`/api/organisms/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      toast.success('Deleted'); refetch();
    } catch { toast.error('Failed to delete organism'); }
  };

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
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="border-b border-border">
              <th className={TH}>Organism</th>
              <th className={TH}>Details</th>
              <th className={`${TH} text-right`}>Coll.</th>
              <th className={`${TH} text-right`}>Files</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
              : (
                <>
                  {data?.map(o => (
                    <tr key={o.id} className="border-b border-border-subtle hover:bg-surface transition-colors duration-fast group">
                      {/* Organism: genus species (line 1), strain + common name (line 2) */}
                      <td className="py-1.5 pl-2.5 pr-3">
                        <div className="flex items-baseline gap-1">
                          <InlineInput value={o.genus} mono className="italic" onCommit={v => handleUpdate(o.id, { genus: v })} />
                          <InlineInput value={o.species} mono className="font-semibold" onCommit={v => handleUpdate(o.id, { species: v })} />
                        </div>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                          <InlineInput value={o.strain ?? ''} placeholder="strain" mono onCommit={v => handleUpdate(o.id, { strain: v || null })} />
                          <InlineInput value={o.commonName ?? ''} placeholder="common name" onCommit={v => handleUpdate(o.id, { commonName: v || null })} />
                        </div>
                      </td>
                      {/* Details: ref genome (line 1), NCBI tax ID (line 2) */}
                      <td className="py-1.5 pl-2.5 pr-3">
                        <InlineInput value={o.referenceGenome ?? ''} placeholder="ref. genome" onCommit={v => handleUpdate(o.id, { referenceGenome: v || null })} />
                        <div className="mt-0.5">
                          <InlineInput value={o.ncbiTaxId?.toString() ?? ''} placeholder="NCBI tax ID" mono onCommit={v => handleUpdate(o.id, { ncbiTaxId: parseInt(v) || null })} />
                        </div>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 font-mono text-caption tabular-nums text-text-secondary text-right align-top pt-2">
                        {o.collectionCount}
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 font-mono text-caption tabular-nums text-text-secondary text-right align-top pt-2">
                        {o.fileCount}
                      </td>
                      <td className="py-1.5 pr-2.5 w-6 align-top pt-2">
                        <button onClick={() => handleDelete(o.id)}
                          className="text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0 text-caption opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                          title="Delete organism">×</button>
                      </td>
                    </tr>
                  ))}

                  {/* Inline add row */}
                  <tr className="text-text-dim">
                    <td className="py-1.5 pl-2.5 pr-3">
                      <div className="flex items-baseline gap-1">
                        <input ref={genusRef} value={newGenus} onChange={e => setNewGenus(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                          placeholder="+ genus"
                          className="bg-transparent border-b border-transparent outline-none font-mono text-caption italic text-text placeholder:text-text-dim p-0 focus:border-accent transition-colors duration-fast"
                          style={{ width: `${Math.max(newGenus.length, 7) + 1}ch` }} />
                        <input value={newSpecies} onChange={e => setNewSpecies(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                          placeholder="species"
                          className="bg-transparent border-b border-transparent outline-none font-mono text-caption font-semibold text-text placeholder:text-text-dim p-0 focus:border-accent transition-colors duration-fast"
                          style={{ width: `${Math.max(newSpecies.length, 7) + 1}ch` }} />
                      </div>
                    </td>
                    <td colSpan={3} />
                    <td className="py-1.5 pr-2.5 w-6">
                      <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${ready ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <button disabled={pending} onClick={handleCreate}
                          className="text-caption text-accent hover:text-text cursor-pointer bg-transparent border-none p-0 font-body" title="Add">✓</button>
                        <button onClick={() => { setNewGenus(''); setNewSpecies(''); }}
                          className="text-caption text-text-dim hover:text-text cursor-pointer bg-transparent border-none p-0 font-body" title="Cancel">×</button>
                      </span>
                    </td>
                  </tr>
                </>
              )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-1.5 md:hidden flex-1 overflow-auto min-h-0">
        {isLoading
          ? [...Array(4)].map((_, i) => (
            <Card key={i} className="p-2.5">
              <div className="skeleton h-4 rounded-sm w-1/2 mb-1" />
              <div className="skeleton h-3 rounded-sm w-3/4" />
            </Card>
          ))
          : !data?.length
            ? <div className="py-8 text-center text-text-dim text-body font-body">No organisms yet.</div>
            : data.map(o => (
              <Card key={o.id} className="p-2.5 flex flex-col gap-1">
                <div className="font-mono text-caption text-text">
                  <span className="text-text-dim italic">{o.genus.charAt(0)}.</span>{' '}
                  <span className="font-semibold">{o.species}</span>
                  {o.strain && <span className="text-text-secondary ml-1">{o.strain}</span>}
                </div>
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
