import { Link } from 'react-router-dom';
import { useStorageStats, useProjectsQuery, useOrganismsQuery, useCollectionsQuery } from '../hooks/useGenomicQueries';
import { FORMAT_META, formatBytes } from '../lib/formats';
import { Heading, Text, Badge, Card } from '../ui';

// ── Stat card ─────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-md p-2.5 flex flex-col gap-0.5">
      <Text variant="overline">{label}</Text>
      <div className="font-display text-display text-accent tabular-nums">{value}</div>
      {sub && <Text variant="caption">{sub}</Text>}
    </div>
  );
}

// ── Format bar ────────────────────────────────────────────

function FormatBar({ items }: { items: { format: string; bytes: number }[] }) {
  const total = items.reduce((s, i) => s + i.bytes, 0);
  if (!total) return null;

  return (
    <div className="flex h-3 rounded-full overflow-hidden gap-px">
      {items.map(item => {
        const fmt  = item.format as keyof typeof FORMAT_META;
        const meta = FORMAT_META[fmt] ?? FORMAT_META.other;
        const pct  = (item.bytes / total) * 100;
        return (
          <div
            key={item.format}
            title={`${meta.label}: ${formatBytes(item.bytes)} (${pct.toFixed(1)}%)`}
            style={{ width: `${pct}%`, background: meta.color, opacity: 0.85 }}
          />
        );
      })}
    </div>
  );
}

// ── Project card (mobile) ────────────────────────────────

function ProjectCard({ project }: { project: { id: string; name: string; description: string | null; fileCount: number; totalBytes: number; createdAt: string } }) {
  return (
    <Link to={`/projects/${project.id}`} className="no-underline">
      <Card className="p-2.5 flex flex-col gap-1 hover:border-accent transition-colors duration-fast cursor-pointer">
        <div className="font-display text-subheading text-accent">{project.name}</div>
        {project.description && (
          <Text variant="caption">{project.description}</Text>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Text variant="caption">{project.fileCount.toLocaleString()} files</Text>
          <Text variant="caption">{formatBytes(project.totalBytes)}</Text>
          <Text variant="caption">
            {new Date(project.createdAt).toLocaleDateString('en-US', {
              year: 'numeric', month: 'short', day: 'numeric',
            })}
          </Text>
        </div>
      </Card>
    </Link>
  );
}

// ── Dashboard ─────────────────────────────────────────────

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useStorageStats();
  const { data: projects, isLoading: projLoading } = useProjectsQuery();
  const { data: organisms, isLoading: orgLoading } = useOrganismsQuery();
  const { data: collections, isLoading: colLoading } = useCollectionsQuery();

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3">
      <Heading level="heading">Dashboard</Heading>

      {/* Top stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard
          label="Total Files"
          value={statsLoading ? '—' : (stats?.totalFiles ?? 0).toLocaleString()}
        />
        <StatCard
          label="Storage Used"
          value={statsLoading ? '—' : formatBytes(stats?.totalBytes ?? 0)}
        />
        <StatCard
          label="Projects"
          value={projLoading ? '—' : (projects?.length ?? 0).toString()}
        />
        <StatCard
          label="Organisms"
          value={orgLoading ? '—' : (organisms?.length ?? 0).toString()}
        />
        <StatCard
          label="Collections"
          value={colLoading ? '—' : (collections?.length ?? 0).toString()}
        />
        <StatCard
          label="Formats"
          value={statsLoading ? '—' : (stats?.byFormat.length ?? 0).toString()}
          sub="distinct file types"
        />
      </div>

      {/* Storage by format */}
      {!statsLoading && stats && stats.byFormat.length > 0 && (
        <div className="bg-surface border border-border rounded-md p-2.5 flex flex-col gap-2">
          <Text variant="overline">Storage by Format</Text>
          <FormatBar items={stats.byFormat} />

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1 mt-1">
            {stats.byFormat.map(item => {
              const fmt  = item.format as keyof typeof FORMAT_META;
              const meta = FORMAT_META[fmt] ?? FORMAT_META.other;
              const pct  = stats.totalBytes > 0
                ? ((item.bytes / stats.totalBytes) * 100).toFixed(1)
                : '0';
              return (
                <div key={item.format}
                  className="flex items-center gap-1.5 p-1 bg-surface-2 rounded-sm">
                  <div className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: meta.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-micro text-text">{meta.label}</div>
                    <div className="font-mono text-micro text-text-dim tabular-nums">
                      {formatBytes(item.bytes)} · {item.count} files
                    </div>
                  </div>
                  <span className="font-mono text-micro text-text-dim tabular-nums shrink-0">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Projects — table on md+, cards on mobile */}
      <div>
        <div className="px-1 md:px-2.5 py-2">
          <Text variant="overline">Projects</Text>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-surface border border-border rounded-md overflow-hidden">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-2">
                {['Name', 'Files', 'Storage', 'Created'].map(h => (
                  <th key={h}
                    className="py-1.5 px-2.5 font-body text-micro uppercase tracking-overline text-text-dim font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projLoading
                ? [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle">
                    {[...Array(4)].map((_, j) => (
                      <td key={j} className="py-2 px-2.5">
                        <div className="skeleton h-3.5 rounded-sm w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
                : !projects?.length
                  ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-text-dim text-body font-body">
                        No projects yet.
                      </td>
                    </tr>
                  )
                  : projects.map(p => (
                    <tr key={p.id}
                      className="border-b border-border-subtle last:border-0 hover:bg-surface-2 transition-colors duration-fast">
                      <td className="py-2 px-2.5">
                        <Link to={`/projects/${p.id}`} className="no-underline">
                          <div className="font-display text-subheading text-accent hover:underline">{p.name}</div>
                        </Link>
                        {p.description && (
                          <div className="text-caption text-text-dim">{p.description}</div>
                        )}
                      </td>
                      <td className="py-2 px-2.5 font-mono text-caption tabular-nums text-text-secondary">
                        {p.fileCount.toLocaleString()}
                      </td>
                      <td className="py-2 px-2.5 font-mono text-caption tabular-nums text-text-secondary">
                        {formatBytes(p.totalBytes)}
                      </td>
                      <td className="py-2 px-2.5 text-caption text-text-dim whitespace-nowrap">
                        {new Date(p.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="flex flex-col gap-1.5 md:hidden">
          {projLoading
            ? [...Array(3)].map((_, i) => (
              <Card key={i} className="p-2.5">
                <div className="skeleton h-4 rounded-sm w-1/2 mb-1" />
                <div className="skeleton h-3 rounded-sm w-3/4" />
              </Card>
            ))
            : !projects?.length
              ? (
                <div className="py-8 text-center text-text-dim text-body font-body">
                  No projects yet.
                </div>
              )
              : projects.map(p => <ProjectCard key={p.id} project={p} />)
          }
        </div>
      </div>
    </div>
  );
}
