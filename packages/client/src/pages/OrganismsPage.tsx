import { useState, useRef } from 'react';
import { cx } from 'class-variance-authority';
import {
  useOrganismsQuery,
  useCreateOrganismMutation,
  useUpdateOrganismMutation,
  useDeleteOrganismMutation,
} from '../hooks/useGenomicQueries';
import { useConfirmDelete } from '../hooks/useConfirmDelete';
import { Badge, Text, Heading, Card, InlineInput, inlineInput, iconAction } from '../ui';
import { formatRelativeTime } from '../lib/formats';

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      <td className="tbl-cell">
        <div className="flex flex-col gap-1">
          <div className="skeleton h-[1lh] w-3/4" />
          <div className="skeleton h-[1lh] w-1/3" />
        </div>
      </td>
      <td className="tbl-cell">
        <div className="flex flex-col gap-1">
          <div className="skeleton h-[1lh] w-1/3" />
          <div className="skeleton h-[1lh] w-1/3" />
        </div>
      </td>
      <td className="tbl-cell text-right align-top pt-2">
        <div className="skeleton h-[1lh] w-1/3 ml-auto" />
      </td>
      <td className="tbl-cell text-right align-top pt-2">
        <div className="skeleton h-[1lh] w-1/3 ml-auto" />
      </td>
      <td />
    </tr>
  );
}

export default function OrganismsPage() {
  const { data, isLoading, isError } = useOrganismsQuery();
  const { createOrganism, pending } = useCreateOrganismMutation();
  const { updateOrganism } = useUpdateOrganismMutation();
  const { deleteOrganism } = useDeleteOrganismMutation();
  const { confirmDelete } = useConfirmDelete(deleteOrganism, 'organism');

  const [newGenus, setNewGenus] = useState('');
  const [newSpecies, setNewSpecies] = useState('');
  const genusRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (!newGenus.trim() || !newSpecies.trim()) return;
    await createOrganism({ genus: newGenus.trim(), species: newSpecies.trim() });
    setNewGenus('');
    setNewSpecies('');
    genusRef.current?.focus();
  };

  const handleUpdate = async (id: string, patch: Record<string, unknown>) => {
    await updateOrganism({ id, patch });
  };

  const ready = newGenus.trim().length > 0 && newSpecies.trim().length > 0;

  return (
    <div className="flex flex-col gap-3 md:gap-4 p-2 md:p-5 h-full min-h-0 animate-page-enter">
      <div className="shrink-0">
        <Heading level="title">Organisms</Heading>
        <Text variant="dim">
          {data ? (
            `${data.length} organism${data.length !== 1 ? 's' : ''}`
          ) : isError ? (
            '—'
          ) : (
            <span className="skeleton h-[1lh] w-16 inline-block align-middle rounded-sm" />
          )}
        </Text>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface">
        <table className="w-full border-collapse text-left table-fixed">
          <thead className="sticky top-0 bg-surface-raised z-sticky">
            <tr className="border-b border-border">
              <th className="tbl-cell">
                <Text variant="muted">Organism</Text>
              </th>
              <th className="tbl-cell">
                <Text variant="muted">Details</Text>
              </th>
              <th className="tbl-cell text-right w-14">
                <Text variant="muted">Coll.</Text>
              </th>
              <th className="tbl-cell text-right w-14">
                <Text variant="muted">Files</Text>
              </th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {isLoading && !isError ? (
              [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            ) : (
              <>
                {data?.map((o, i) => (
                  <tr
                    key={o.id}
                    className="border-b border-border group stagger-item row-hover"
                    style={{ '--i': Math.min(i, 15) } as React.CSSProperties}
                  >
                    <td className="tbl-cell overflow-hidden">
                      <div className="flex items-baseline gap-1 min-w-0">
                        <InlineInput
                          value={o.genus}
                          className="italic"
                          onCommit={(v) => handleUpdate(o.id, { genus: v })}
                        />
                        <InlineInput
                          value={o.species}
                          className="font-semibold"
                          onCommit={(v) => handleUpdate(o.id, { species: v })}
                        />
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                        <InlineInput
                          value={o.strain ?? ''}
                          placeholder="strain"
                          onCommit={(v) => handleUpdate(o.id, { strain: v || null })}
                        />
                        <InlineInput
                          value={o.commonName ?? ''}
                          placeholder="common name"
                          onCommit={(v) => handleUpdate(o.id, { commonName: v || null })}
                        />
                      </div>
                    </td>
                    <td className="tbl-cell overflow-hidden">
                      <InlineInput
                        value={o.referenceGenome ?? ''}
                        placeholder="ref. genome"
                        onCommit={(v) => handleUpdate(o.id, { referenceGenome: v || null })}
                      />
                      <div className="mt-0.5">
                        <InlineInput
                          value={o.ncbiTaxId?.toString() ?? ''}
                          placeholder="NCBI tax ID"
                          onCommit={(v) => handleUpdate(o.id, { ncbiTaxId: parseInt(v) || null })}
                        />
                      </div>
                    </td>
                    <td className="tbl-cell text-right align-top pt-2">
                      <Text variant="dim" className="tabular-nums">
                        {o.collectionCount}
                      </Text>
                    </td>
                    <td className="tbl-cell text-right align-top pt-2">
                      <Text variant="dim" className="tabular-nums">
                        {o.fileCount}
                      </Text>
                    </td>
                    <td className="tbl-cell-end w-6 align-top pt-2">
                      <button
                        onClick={() => confirmDelete(o.id, `${o.genus} ${o.species}`)}
                        className={iconAction({ color: 'danger', reveal: true })}
                        title="Delete organism"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Inline add row */}
                <tr className="text-text-faint">
                  <td className="tbl-cell overflow-hidden">
                    <div className="flex items-baseline gap-1 min-w-0">
                      <input
                        ref={genusRef}
                        value={newGenus}
                        onChange={(e) => setNewGenus(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreate();
                        }}
                        placeholder="+ genus"
                        className={cx(inlineInput({ font: 'body' }), 'italic flex-1 min-w-0')}
                      />
                      <input
                        value={newSpecies}
                        onChange={(e) => setNewSpecies(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreate();
                        }}
                        placeholder="species"
                        className={cx(
                          inlineInput({ font: 'body' }),
                          'font-semibold flex-1 min-w-0',
                        )}
                      />
                    </div>
                  </td>
                  <td colSpan={3} />
                  <td className="tbl-cell-end w-6">
                    <span
                      className={`inline-flex items-center gap-1 transition-opacity duration-fast ${ready ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    >
                      <button
                        disabled={pending}
                        onClick={handleCreate}
                        className={iconAction({ color: 'accent' })}
                        title="Add"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => {
                          setNewGenus('');
                          setNewSpecies('');
                        }}
                        className={iconAction({ color: 'dim' })}
                        title="Cancel"
                      >
                        ×
                      </button>
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
        {isLoading && !isError ? (
          [...Array(4)].map((_, i) => (
            <Card key={i} className="p-2.5 flex flex-col gap-1">
              <div className="skeleton h-[1lh] w-3/4" />
              <div className="skeleton h-[1lh] w-1/3" />
            </Card>
          ))
        ) : !data?.length ? (
          <Text variant="body" className="py-8 text-center text-text-faint animate-fade-up">
            No organisms yet.
          </Text>
        ) : (
          data.map((o) => (
            <Card key={o.id} className="p-2.5 flex flex-col gap-1">
              <Text variant="body">
                <span className="text-text-faint italic">{o.genus.charAt(0)}.</span>{' '}
                <span className="font-semibold">{o.species}</span>
                {o.strain && <span className="text-text-muted ml-1">{o.strain}</span>}
              </Text>
              {o.commonName && <Text variant="dim">{o.commonName}</Text>}
              <div className="flex items-center gap-2 flex-wrap">
                {o.referenceGenome && (
                  <Badge variant="count" color="dim">
                    {o.referenceGenome}
                  </Badge>
                )}
                {o.ncbiTaxId && <Text variant="dim">NCBI: {o.ncbiTaxId}</Text>}
                <Text variant="dim">{o.collectionCount} coll</Text>
                <Text variant="dim">{o.fileCount} files</Text>
                <Text variant="dim">{formatRelativeTime(o.createdAt)}</Text>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
