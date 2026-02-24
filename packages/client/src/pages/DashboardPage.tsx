import { Link } from 'react-router-dom';
import { useStorageStats, useOrganismsQuery, useCollectionsQuery } from '../hooks/useGenomicQueries';
import { FORMAT_META, formatBytes } from '../lib/formats';
import { Heading, Text, Badge, Card } from '../ui';

// ── Stat card ─────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-base border border-line rounded-md p-2.5 flex flex-col gap-0.5">
      <Text variant="muted">{label}</Text>
      <Heading level="heading" className="tabular-nums">{value}</Heading>
      {sub && <Text variant="dim">{sub}</Text>}
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
        <div className="bg-base border border-line rounded-md p-2.5 flex flex-col gap-2">
          <Text variant="muted">Storage by Format</Text>
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
                  className="flex items-center gap-1.5 p-1 bg-raised rounded-sm">
                  <div className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: meta.color }} />
                  <div className="min-w-0 flex-1">
                    <Text variant="body">{meta.label}</Text>
                    <Text variant="dim" className="tabular-nums">
                      {formatBytes(item.bytes)} · {item.count} files
                    </Text>
                  </div>
                  <Text variant="dim" className="shrink-0 tabular-nums">{pct}%</Text>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
