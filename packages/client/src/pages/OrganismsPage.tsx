import { useState } from 'react';
import { useOrganismsQuery, useCreateOrganismMutation } from '../hooks/useGenomicQueries';
import { formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card } from '../ui';

// ── Skeleton row ─────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="py-2 pr-3">
          <div className="skeleton h-4 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── OrganismsPage ────────────────────────────────────────

export default function OrganismsPage() {
  const { data, isLoading, refetch } = useOrganismsQuery();
  const { createOrganism, pending } = useCreateOrganismMutation(refetch);

  const [genus,           setGenus]           = useState('');
  const [species,         setSpecies]         = useState('');
  const [strain,          setStrain]          = useState('');
  const [commonName,      setCommonName]      = useState('');
  const [ncbiTaxId,       setNcbiTaxId]       = useState('');
  const [referenceGenome, setReferenceGenome] = useState('');

  const handleCreate = async () => {
    if (!genus || !species) return;
    await createOrganism({
      genus, species,
      strain: strain || undefined,
      commonName: commonName || undefined,
      ncbiTaxId: ncbiTaxId ? parseInt(ncbiTaxId) : undefined,
      referenceGenome: referenceGenome || undefined,
    });
    setGenus(''); setSpecies(''); setStrain('');
    setCommonName(''); setNcbiTaxId(''); setReferenceGenome('');
  };

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {/* Header */}
      <div className="shrink-0">
        <Heading level="heading">Organisms</Heading>
        <Text variant="caption">
          {data ? `${data.length} organism${data.length !== 1 ? 's' : ''}` : 'Loading...'}
        </Text>
      </div>

      {/* Create form — wraps on all sizes, full-width inputs on mobile */}
      <div className="flex items-end gap-2 shrink-0 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Genus</Text>
          <Input variant="surface" size="sm" placeholder="Genus" value={genus} onChange={e => setGenus(e.target.value)} className="w-full sm:w-36" />
        </div>
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Species</Text>
          <Input variant="surface" size="sm" placeholder="Species" value={species} onChange={e => setSpecies(e.target.value)} className="w-full sm:w-36" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Strain</Text>
          <Input variant="surface" size="sm" placeholder="Strain" value={strain} onChange={e => setStrain(e.target.value)} className="w-full sm:w-28" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Common Name</Text>
          <Input variant="surface" size="sm" placeholder="Common name" value={commonName} onChange={e => setCommonName(e.target.value)} className="w-full sm:w-32" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">NCBI Tax ID</Text>
          <Input variant="surface" size="sm" placeholder="Tax ID" value={ncbiTaxId} onChange={e => setNcbiTaxId(e.target.value)} className="w-full sm:w-24" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Ref. Genome</Text>
          <Input variant="surface" size="sm" placeholder="Genome" value={referenceGenome} onChange={e => setReferenceGenome(e.target.value)} className="w-full sm:w-24" />
        </div>
        <Button intent="primary" size="sm" pending={pending} onClick={handleCreate} disabled={!genus || !species} className="w-full sm:w-auto">
          Add
        </Button>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="border-b border-border">
              {['Organism', 'Common Name', 'Ref. Genome', 'NCBI Tax ID', 'Experiments', 'Files', 'Created'].map(h => (
                <th key={h} className="py-1.5 pr-3 pl-2.5 font-body text-micro uppercase tracking-overline text-text-dim font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
              : !data?.length
                ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-text-dim font-body text-body">
                      No organisms yet. Add one above.
                    </td>
                  </tr>
                )
                : data.map(o => (
                  <tr key={o.id} className="border-b border-border-subtle transition-colors duration-fast hover:bg-surface group">
                    <td className="py-1.5 pl-2.5 pr-3">
                      <div className="font-mono text-caption text-text">
                        <span className="text-text-dim italic">{o.genus.charAt(0)}.</span>{' '}
                        <span className="font-semibold">{o.species}</span>
                        {o.strain && <span className="text-text-secondary ml-1">{o.strain}</span>}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-caption text-text-secondary">{o.commonName ?? '—'}</td>
                    <td className="py-1.5 pr-3">
                      {o.referenceGenome
                        ? <Badge variant="count" color="dim">{o.referenceGenome}</Badge>
                        : <span className="text-caption text-text-dim">—</span>
                      }
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-caption text-text-dim tabular-nums">
                      {o.ncbiTaxId ?? '—'}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary">
                      {o.experimentCount}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary">
                      {o.fileCount}
                    </td>
                    <td className="py-1.5 pr-3 text-caption text-text-dim whitespace-nowrap">
                      {formatRelativeTime(o.createdAt)}
                    </td>
                  </tr>
                ))
            }
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
            ? (
              <div className="py-8 text-center text-text-dim text-body font-body">
                No organisms yet. Add one above.
              </div>
            )
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
                  <Text variant="caption">{o.experimentCount} exp</Text>
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
