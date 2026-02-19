import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import { useAppStore, type UploadProgress } from '../stores/useAppStore';
import { formatBytes } from '../lib/formats';
import { Text, iconAction } from '../ui';

export default function GlobalUploadProgress() {
  const uploads = useAppStore(s => s.uploads);
  const clearDoneUploads = useAppStore(s => s.clearDoneUploads);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const all = useMemo(() => [...uploads.values()], [uploads]);
  const active = useMemo(() => all.filter(u => u.status === 'uploading'), [all]);
  const done = useMemo(() => all.filter(u => u.status === 'done'), [all]);
  const errored = useMemo(() => all.filter(u => u.status === 'error'), [all]);

  // Auto-dismiss when all done + no errors, after 4s
  useEffect(() => {
    if (active.length === 0 && done.length > 0 && errored.length === 0) {
      const t = setTimeout(() => {
        clearDoneUploads();
        setDismissed(true);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [active.length, done.length, errored.length, clearDoneUploads]);

  // Reset dismissed state when new uploads start
  useEffect(() => {
    if (active.length > 0) setDismissed(false);
  }, [active.length]);

  // Nothing to show
  if (all.length === 0 || dismissed) return null;

  // Overall progress
  const totalBytes = all.reduce((s, u) => s + u.total, 0);
  const loadedBytes = all.reduce((s, u) => s + u.loaded, 0);
  const overallPct = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;
  const allDone = active.length === 0;

  return (
    <div
      className="fixed bottom-3 right-3 z-50 animate-fade-in"
      style={{ width: collapsed ? 'auto' : 280 }}
    >
      <div
        className="bg-surface border border-border rounded-md shadow-lg overflow-hidden"
        style={{ backdropFilter: 'blur(8px)' }}
      >
        {/* Header bar — always visible */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 cursor-pointer bg-transparent border-none text-left"
        >
          {/* Animated spinner or checkmark */}
          {active.length > 0 ? (
            <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 animate-spin" style={{ color: 'var(--color-accent)' }}>
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : errored.length > 0 ? (
            <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" style={{ color: 'var(--color-red)' }}>
              <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" style={{ color: 'var(--color-green)' }}>
              <path d="M3 7l3 3 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}

          <Text variant="caption" className="flex-1 min-w-0 truncate text-text">
            {active.length > 0
              ? `Uploading ${active.length} file${active.length !== 1 ? 's' : ''} · ${overallPct}%`
              : errored.length > 0
                ? `${errored.length} failed · ${done.length} done`
                : `${done.length} upload${done.length !== 1 ? 's' : ''} complete`}
          </Text>

          <svg
            width="10" height="10" viewBox="0 0 10 10"
            className={cx('shrink-0 text-text-dim transition-transform duration-fast', collapsed ? '' : 'rotate-180')}
          >
            <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Overall progress bar */}
        {active.length > 0 && (
          <div className="h-0.5" style={{ background: 'var(--color-surface-2)' }}>
            <div
              className="h-full transition-all duration-normal"
              style={{ width: `${overallPct}%`, background: 'var(--color-accent)' }}
            />
          </div>
        )}

        {/* Expanded file list */}
        {!collapsed && (
          <div className="max-h-48 overflow-y-auto">
            {all.map(u => (
              <UploadRow key={u.fileId} upload={u} />
            ))}

            {/* Footer actions */}
            <div className="flex items-center justify-between px-2.5 py-1 border-t border-border-subtle">
              <Link to="/upload" className="no-underline">
                <Text variant="caption" className="hover:text-accent transition-colors duration-fast">
                  Open uploads
                </Text>
              </Link>
              {allDone && (
                <button
                  onClick={e => { e.stopPropagation(); clearDoneUploads(); }}
                  className={iconAction({ color: 'dim' })}
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadRow({ upload }: { upload: UploadProgress }) {
  const pct = upload.total > 0 ? Math.round((upload.loaded / upload.total) * 100) : 0;

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 border-t border-border-subtle">
      <Text variant="mono" className="flex-1 min-w-0 truncate">
        {upload.filename}
      </Text>
      <Text variant="mono" className="shrink-0 text-micro tabular-nums" style={{
        color: upload.status === 'done' ? 'var(--color-green)'
             : upload.status === 'error' ? 'var(--color-red)'
             : 'var(--color-text-dim)',
      }}>
        {upload.status === 'done' ? '\u2713'
          : upload.status === 'error' ? '\u2717'
          : `${pct}%`}
      </Text>
    </div>
  );
}
