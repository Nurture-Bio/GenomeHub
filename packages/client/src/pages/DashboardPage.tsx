import {
  useStorageStats,
  useOrganismsQuery,
  useCollectionsQuery,
} from '../hooks/useGenomicQueries';
import { FORMAT_META, formatBytes } from '../lib/formats';
import { Heading, Text } from '../ui';
import { useCountUp } from '../hooks/useCountUp';

// ── Stat card ─────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  const animated = useCountUp(value ?? 0);
  return (
    <div className="stat-card-surface p-3 flex flex-col gap-0.5">
      <Text variant="muted">{label}</Text>
      <Heading level="display" className="tabular-nums">
        {value === null ? (
          <span className="skeleton h-[1lh] w-10 inline-block align-middle rounded-sm" />
        ) : (
          animated.toLocaleString()
        )}
      </Heading>
      {sub && <Text variant="dim">{sub}</Text>}
    </div>
  );
}

function StorageStatCard({ label, bytes }: { label: string; bytes: number | null }) {
  const animated = useCountUp(bytes ?? 0);
  return (
    <div className="stat-card-surface p-3 flex flex-col gap-0.5">
      <Text variant="muted">{label}</Text>
      <Heading level="display" className="tabular-nums">
        {bytes === null ? (
          <span className="skeleton h-[1lh] w-16 inline-block align-middle rounded-sm" />
        ) : (
          formatBytes(animated)
        )}
      </Heading>
    </div>
  );
}

// ── Format bar ────────────────────────────────────────────

function FormatBar({ items }: { items: { format: string; bytes: number }[] }) {
  const total = items.reduce((s, i) => s + i.bytes, 0);
  if (!total) return null;

  return (
    <div className="flex h-3 rounded-full overflow-hidden gap-px">
      {items.map((item) => {
        const fmt = item.format as keyof typeof FORMAT_META;
        const meta = FORMAT_META[fmt] ?? FORMAT_META.other;
        const pct = (item.bytes / total) * 100;
        return (
          <div
            key={item.format}
            className="format-bar-seg"
            title={`${meta.label}: ${formatBytes(item.bytes)} (${pct.toFixed(1)}%)`}
            style={{
              '--seg-bg': meta.bg,
              '--seg-fg': meta.color,
              width: `${pct}%`,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading, isError: statsError } = useStorageStats();
  const { data: organisms, isLoading: orgLoading, isError: orgError } = useOrganismsQuery();
  const { data: collections, isLoading: colLoading, isError: colError } = useCollectionsQuery();

  return (
    <div className="flex flex-col gap-3 md:gap-4 p-2 md:p-5 animate-page-enter">
      <Heading level="title">Dashboard</Heading>

      {/* Top stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard
          label="Total Files"
          value={statsLoading && !statsError ? null : (stats?.totalFiles ?? 0)}
        />
        <StorageStatCard
          label="Storage Used"
          bytes={statsLoading && !statsError ? null : (stats?.totalBytes ?? 0)}
        />
        <StatCard
          label="Organisms"
          value={orgLoading && !orgError ? null : (organisms?.length ?? 0)}
        />
        <StatCard
          label="Collections"
          value={colLoading && !colError ? null : (collections?.length ?? 0)}
        />
        <StatCard
          label="Formats"
          value={statsLoading && !statsError ? null : (stats?.byFormat.length ?? 0)}
          sub="distinct file types"
        />
      </div>

      {/* Storage by format */}
      {!statsLoading && stats && stats.byFormat.length > 0 && (
        <div className="bg-surface border border-border rounded-md p-3 flex flex-col gap-2">
          <Text variant="muted">Storage by Format</Text>
          <FormatBar items={stats.byFormat} />

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1 mt-1">
            {stats.byFormat.map((item, i) => {
              const fmt = item.format as keyof typeof FORMAT_META;
              const meta = FORMAT_META[fmt] ?? FORMAT_META.other;
              const pct =
                stats.totalBytes > 0 ? ((item.bytes / stats.totalBytes) * 100).toFixed(1) : '0';
              return (
                <div
                  key={item.format}
                  className="flex items-center gap-1.5 p-1 bg-surface-raised rounded-sm stagger-item"
                  style={{ '--i': Math.min(i, 15) } as React.CSSProperties}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: meta.bg, boxShadow: `0 0 4px ${meta.color}` }}
                  />
                  <div className="min-w-0 flex-1">
                    <Text variant="body">{meta.label}</Text>
                    <Text variant="dim" className="tabular-nums">
                      {formatBytes(item.bytes)} · {item.count} files
                    </Text>
                  </div>
                  <Text variant="dim" className="shrink-0 tabular-nums">
                    {pct}%
                  </Text>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
