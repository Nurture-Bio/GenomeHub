import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjectsQuery, useCreateProjectMutation } from '../hooks/useGenomicQueries';
import { formatBytes, formatRelativeTime } from '../lib/formats';
import { Button, Input, Text, Heading, Card } from '../ui';

// ── Skeleton row ─────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(4)].map((_, i) => (
        <td key={i} className="py-2 pr-3">
          <div className="skeleton h-4 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── ProjectsPage ─────────────────────────────────────────

export default function ProjectsPage() {
  const { data, isLoading, refetch } = useProjectsQuery();
  const { createProject, pending } = useCreateProjectMutation(refetch);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = async () => {
    if (!name) return;
    await createProject({
      name,
      description: description || undefined,
    });
    setName('');
    setDescription('');
  };

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {/* Header */}
      <div className="shrink-0">
        <Heading level="heading">Projects</Heading>
        <Text variant="caption">
          {data ? `${data.length} project${data.length !== 1 ? 's' : ''}` : 'Loading\u2026'}
        </Text>
      </div>

      {/* Create form */}
      <div className="flex items-end gap-2 shrink-0 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Name</Text>
          <Input variant="surface" size="sm" placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="w-full sm:w-52" />
        </div>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <Text variant="overline">Description</Text>
          <Input variant="surface" size="sm" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="w-full" />
        </div>
        <Button intent="primary" size="sm" pending={pending} onClick={handleCreate} disabled={!name} className="w-full sm:w-auto">
          Add
        </Button>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="border-b border-border">
              {['Name', 'Files', 'Storage', 'Created'].map(h => (
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
                    <td colSpan={4} className="py-12 text-center text-text-dim font-body text-body">
                      No projects yet. Create one above.
                    </td>
                  </tr>
                )
                : data.map(p => (
                  <tr key={p.id} className="border-b border-border-subtle transition-colors duration-fast hover:bg-surface group">
                    <td className="py-1.5 pl-2.5 pr-3">
                      <Link to={`/projects/${p.id}`} className="no-underline">
                        <div className="font-display text-subheading text-accent hover:underline">{p.name}</div>
                      </Link>
                      {p.description && <div className="text-micro text-text-dim truncate max-w-xs">{p.description}</div>}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary">
                      {p.fileCount.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary">
                      {formatBytes(p.totalBytes)}
                    </td>
                    <td className="py-1.5 pr-3 text-caption text-text-dim whitespace-nowrap">
                      {formatRelativeTime(p.createdAt)}
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
                No projects yet. Create one above.
              </div>
            )
            : data.map(p => (
              <Link key={p.id} to={`/projects/${p.id}`} className="no-underline">
                <Card className="p-2.5 flex flex-col gap-1 hover:border-accent transition-colors duration-fast cursor-pointer">
                  <div className="font-display text-subheading text-accent">{p.name}</div>
                  {p.description && <Text variant="caption">{p.description}</Text>}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Text variant="caption">{p.fileCount.toLocaleString()} files</Text>
                    <Text variant="caption">{formatBytes(p.totalBytes)}</Text>
                    <Text variant="caption">{formatRelativeTime(p.createdAt)}</Text>
                  </div>
                </Card>
              </Link>
            ))
        }
      </div>
    </div>
  );
}
