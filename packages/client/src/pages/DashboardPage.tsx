import { Link } from 'react-router-dom';
import { useStorageStats, useOrganismsQuery, useCollectionsQuery } from '../hooks/useGenomicQueries';
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

// ── Dashboard ─────────────────────────────────────────────

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useStorageStats();
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
    </div>
  );
}
