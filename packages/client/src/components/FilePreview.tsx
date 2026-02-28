import { useRef, useEffect, useCallback, useState } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import type { FilePreviewPage } from '../hooks/useGenomicQueries';
import { usePresignedUrl } from '../hooks/useGenomicQueries';
import { apiFetch } from '../lib/api';
import JsonStrandPreview from './JsonStrandPreview';
import ParquetPreview from './ParquetPreview';
import { Text, Badge } from '../ui';

interface FilePreviewProps {
  fileId:    string;
  filename:  string;
  sizeBytes: number;
}

const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50 MB

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

// ── Dataset error state ─────────────────────────────────────────────────────

function DatasetErrorState({ error, sizeBytes, fileId }: {
  error:     string;
  sizeBytes: number;
  fileId:    string;
}) {
  return (
    <div className="flex items-center justify-center rounded-md border border-line"
      style={{ background: 'var(--color-base)', minHeight: 280 }}>
      <div className="flex flex-col items-center gap-4 px-8 py-10" style={{ maxWidth: 480, textAlign: 'center' }}>
        <div className="flex items-center justify-center rounded-full"
          style={{ width: 48, height: 48, background: 'oklch(0.350 0.100 30 / 0.25)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.5"
            stroke="oklch(0.650 0.180 30)" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-semibold" style={{ fontSize: 'var(--font-size-md)', color: 'var(--color-fg)' }}>
            Dataset Preview Unavailable
          </span>
          <Text variant="dim" style={{ lineHeight: 1.5 }}>
            This {formatBytes(sizeBytes)} file failed to convert to a queryable format.
            Re-uploading the file will retry the conversion automatically.
          </Text>
          <div className="font-mono rounded border border-line px-3 py-2 mt-1"
            style={{
              fontSize: 'calc(var(--font-size-xs) - 1px)',
              color: 'var(--color-fg-3)',
              background: 'var(--color-void)',
              textAlign: 'left',
              wordBreak: 'break-word',
            }}>
            {error}
          </div>
          <Text variant="dim" style={{ fontSize: 'var(--font-size-xs)' }}>
            File ID: {fileId}
          </Text>
        </div>
      </div>
    </div>
  );
}

// ── JSON preview: Parquet path with Strand fallback ─────────────────────────

function JsonPreview({ fileId, sizeBytes }: { fileId: string; sizeBytes: number }) {
  const [mode, setMode] = useState<'checking' | 'parquet' | 'strand' | 'fatal'>('checking');
  const [fatalError, setFatalError] = useState<string>('');
  const { getUrl }      = usePresignedUrl();
  const [url, setUrl]   = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isLarge = sizeBytes > LARGE_FILE_THRESHOLD;

  // Check if Parquet sidecar is available
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await apiFetch(`/api/files/${fileId}/parquet-url`);
        const data = await res.json();
        if (cancelled) return;

        if (data.status === 'ready' || data.status === 'converting') {
          setMode('parquet');
        } else if ((data.status === 'failed' || data.status === 'error') && isLarge) {
          setFatalError(data.error ?? 'Conversion failed — no details available');
          setMode('fatal');
        } else {
          // Small file or unavailable → Strand fallback is safe
          setMode('strand');
        }
      } catch (err) {
        if (!cancelled) {
          if (isLarge) {
            setFatalError(err instanceof Error ? err.message : String(err));
            setMode('fatal');
          } else {
            setMode('strand');
          }
        }
      }
    }

    check();
    return () => { cancelled = true; };
  }, [fileId, isLarge]);

  // Strand fallback: resolve presigned URL
  useEffect(() => {
    if (mode !== 'strand') return;
    let cancelled = false;
    getUrl(fileId).then(u => {
      if (!cancelled) setUrl(u);
    }).catch(e => {
      if (!cancelled) setError(String(e));
    });
    return () => { cancelled = true; };
  }, [fileId, getUrl, mode]);

  if (mode === 'checking') {
    return <div className="skeleton h-1 rounded-full w-1/2" />;
  }

  if (mode === 'fatal') {
    return <DatasetErrorState error={fatalError} sizeBytes={sizeBytes} fileId={fileId} />;
  }

  if (mode === 'parquet') {
    return <ParquetPreview fileId={fileId} />;
  }

  // Strand fallback
  if (error) return <Text variant="dim" style={{ color: 'var(--color-red)' }}>{error}</Text>;
  if (!url)  return <div className="skeleton h-1 rounded-full w-1/2" />;
  return <JsonStrandPreview url={url} />;
}

// ── Plain text preview with infinite scroll ──────────────

interface TextPreviewProps {
  pages:              FilePreviewPage[];
  isFetchingNextPage: boolean;
  hasNextPage:        boolean;
  fetchNextPage:      () => void;
}

function TextPreview({ pages, isFetchingNextPage, hasNextPage, fetchNextPage }: TextPreviewProps) {
  const scrollRef   = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const onIntersect = useCallback(
    ([entry]: IntersectionObserverEntry[]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroll   = scrollRef.current;
    if (!sentinel || !scroll) return;
    const observer = new IntersectionObserver(onIntersect, { root: scroll, rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onIntersect]);

  const allLines = pages.flatMap(p => p.lines);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Text variant="muted">Preview</Text>
        {hasNextPage && <Badge variant="count" color="dim">{allLines.length} lines</Badge>}
      </div>
      <div
        ref={scrollRef}
        className="overflow-auto rounded-md border border-line"
        style={{ background: 'var(--color-void)', maxHeight: 400 }}
      >
        <pre className="font-mono text-body text-fg-2 p-2 m-0 leading-relaxed">
          <code>{allLines.join('\n')}</code>
        </pre>
        <div ref={sentinelRef} style={{ height: 1 }} />
        {isFetchingNextPage && (
          <div className="px-2 pb-2 flex flex-col gap-1">
            <div className="skeleton h-[1lh] rounded" style={{ width: '70%' }} />
            <div className="skeleton h-[1lh] rounded" style={{ width: '50%' }} />
            <div className="skeleton h-[1lh] rounded" style={{ width: '60%' }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main preview component ───────────────────────────────

export default function FilePreview({ fileId, filename, sizeBytes }: FilePreviewProps) {
  const isJson = filename.toLowerCase().endsWith('.json');

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteFilePreview(!isJson ? fileId : undefined);

  if (isJson) {
    return <JsonPreview fileId={fileId} sizeBytes={sizeBytes} />;
  }

  if (isLoading) return <div className="skeleton h-32 rounded-md" />;

  const firstPage = data?.pages[0];
  if (!firstPage?.previewable || !firstPage.lines.length) return null;

  return (
    <TextPreview
      pages={data!.pages}
      isFetchingNextPage={isFetchingNextPage}
      hasNextPage={!!hasNextPage}
      fetchNextPage={fetchNextPage}
    />
  );
}
