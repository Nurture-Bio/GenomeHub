import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import * as Toast from '@radix-ui/react-toast';
import { useAppStore, type UploadProgress } from '../stores/useAppStore';
import { Text, RiverGauge, iconAction } from '../ui';

export default function GlobalUploadProgress() {
  const uploads = useAppStore((s) => s.uploads);
  const clearUploads = useAppStore((s) => s.clearUploads);
  const [open, setOpen] = useState(false);

  const all = useMemo(() => [...uploads.values()], [uploads]);
  const active = useMemo(() => all.filter((u) => u.status === 'uploading'), [all]);
  const done = useMemo(() => all.filter((u) => u.status === 'done'), [all]);
  const errored = useMemo(() => all.filter((u) => u.status === 'error'), [all]);

  const allDone = active.length === 0;
  const hasUploads = all.length > 0;

  // Open when uploads appear
  useEffect(() => {
    if (hasUploads) setOpen(true);
  }, [hasUploads]);

  // Auto-dismiss 4s after all complete with no errors
  useEffect(() => {
    if (allDone && errored.length === 0 && done.length > 0) {
      const t = setTimeout(() => {
        clearUploads();
        setOpen(false);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [allDone, errored.length, done.length, clearUploads]);

  const totalBytes = all.reduce((s, u) => s + u.total, 0);
  const loadedBytes = all.reduce((s, u) => s + u.loaded, 0);
  const overallPct = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      clearUploads();
      setOpen(false);
    }
  };

  return (
    <Toast.Provider swipeDirection="right">
      <Toast.Root
        open={open}
        onOpenChange={handleOpenChange}
        duration={Infinity}
        className="bg-base border border-line rounded-md shadow-lg overflow-hidden animate-fade-in"
        style={{ width: 280, backdropFilter: 'blur(8px)' }}
      >
        {/* Status header */}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          {active.length > 0 ? (
            <div
              className="w-2 h-2 rounded-full shrink-0 stepper-ping"
              style={{ background: 'var(--color-cyan)' }}
            />
          ) : errored.length > 0 ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              className="shrink-0"
              style={{ color: 'var(--color-red)' }}
            >
              <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M5 5l4 4M9 5l-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              className="shrink-0"
              style={{ color: 'var(--color-green)' }}
            >
              <path
                d="M3 7l3 3 5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}

          <Toast.Title asChild>
            <Text variant="dim" className="flex-1 min-w-0 truncate text-fg">
              {active.length > 0
                ? `Uploading ${active.length} file${active.length !== 1 ? 's' : ''} · ${overallPct}%`
                : errored.length > 0
                  ? `${errored.length} failed · ${done.length} done`
                  : `${done.length} upload${done.length !== 1 ? 's' : ''} complete`}
            </Text>
          </Toast.Title>

          {allDone && (
            <Toast.Close asChild>
              <button className={iconAction({ color: 'dim' })} title="Dismiss">
                ×
              </button>
            </Toast.Close>
          )}
        </div>

        {/* Overall progress — waterfall gauge */}
        {active.length > 0 && (
          <div className="px-2.5 pb-1.5">
            <RiverGauge
              current={loadedBytes}
              total={totalBytes}
              variant="waterfall"
              resetKey={active.length}
              compact
              accent
            />
          </div>
        )}

        {/* File list */}
        <div className="max-h-48 overflow-y-auto">
          {all.map((u) => (
            <UploadRow key={u.fileId} upload={u} />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-2.5 py-1 border-t border-line">
          <Link to="/upload" className="no-underline">
            <Text variant="dim" className="hover:text-cyan transition-colors duration-fast">
              Open uploads
            </Text>
          </Link>
        </div>
      </Toast.Root>

      <Toast.Viewport className="fixed bottom-3 right-3 z-toast flex flex-col gap-2 outline-none list-none m-0 p-0" />
    </Toast.Provider>
  );
}

function UploadRow({ upload }: { upload: UploadProgress }) {
  const pct = upload.total > 0 ? Math.round((upload.loaded / upload.total) * 100) : 0;

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 border-t border-line">
      {upload.status === 'done' ? (
        <Link
          to={`/files/${upload.fileId}`}
          className="flex-1 min-w-0 truncate no-underline hover:text-cyan transition-colors duration-fast"
        >
          <Text variant="mono">{upload.filename}</Text>
        </Link>
      ) : (
        <Text variant="mono" className="flex-1 min-w-0 truncate">
          {upload.filename}
        </Text>
      )}
      <Text
        variant="dim"
        className="shrink-0 tabular-nums"
        style={{
          color:
            upload.status === 'done'
              ? 'var(--color-green)'
              : upload.status === 'error'
                ? 'var(--color-red)'
                : 'var(--color-fg-3)',
        }}
      >
        {upload.status === 'done' ? '\u2713' : upload.status === 'error' ? '\u2717' : `${pct}%`}
      </Text>
    </div>
  );
}
