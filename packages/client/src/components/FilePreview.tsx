import { useRef, useEffect, useCallback, useState } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import type { FilePreviewPage } from '../hooks/useGenomicQueries';
import { usePresignedUrl } from '../hooks/useGenomicQueries';
import JsonHeadPreview from './JsonHeadPreview';
import ParquetPreview from './ParquetPreview';
import { detectFormat, isConvertible } from '../lib/formats';
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

// ── Dataset preview: Parquet path with head-preview fallback ─────────────────

function DatasetPreview({ fileId, sizeBytes, filename }: {
  fileId: string; sizeBytes: number; filename: string;
}) {
  const [fallback, setFallback] = useState<{ status: string; error?: string } | null>(null);
  const { getUrl }      = usePresignedUrl();
  const [url, setUrl]   = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const isLarge = sizeBytes > LARGE_FILE_THRESHOLD;

  // ParquetPreview calls this when Parquet path is not viable
  const handleFallback = useCallback((info: { status: string; error?: string }) => {
    setFallback(info);
  }, []);

  // Head preview: resolve presigned URL when falling back
  useEffect(() => {
    if (!fallback || isLarge) return;
    let cancelled = false;
    getUrl(fileId).then(u => {
      if (!cancelled) setUrl(u);
    }).catch(e => {
      if (!cancelled) setUrlError(String(e));
    });
    return () => { cancelled = true; };
  }, [fileId, getUrl, fallback, isLarge]);

  // Large file + Parquet failed → error state
  if (fallback && isLarge) {
    return <DatasetErrorState
      error={fallback.error ?? 'Conversion failed — no details available'}
      sizeBytes={sizeBytes}
      fileId={fileId}
    />;
  }

  // Small file + Parquet failed → format-specific head preview fallback
  if (fallback) {
    if (urlError) return <Text variant="dim" style={{ color: 'var(--color-red)' }}>{urlError}</Text>;
    if (!url) return <div className="skeleton h-1 rounded-full w-1/2" />;
    if (detectFormat(filename) === 'json') {
      return <JsonHeadPreview url={url} />;
    }
    return null;
  }

  // Primary path: ParquetPreview handles polling, init, and display
  return <ParquetPreview fileId={fileId} onFallback={handleFallback} />;
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
  const convertible = isConvertible(filename);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteFilePreview(!convertible ? fileId : undefined);

  if (convertible) {
    return <DatasetPreview fileId={fileId} sizeBytes={sizeBytes} filename={filename} />;
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
