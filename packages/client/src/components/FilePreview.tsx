import { useRef, useEffect, useCallback } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import { Text, Badge } from '../ui';

interface FilePreviewProps {
  fileId: string;
  filename: string;
}

// ── Main preview component ──────────────────────────────

export default function FilePreview({ fileId }: FilePreviewProps) {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteFilePreview(fileId);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Stable callback so the observer effect only re-runs when these values change
  const onIntersect = useCallback(
    ([entry]: IntersectionObserverEntry[]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroll   = scrollRef.current;
    if (!sentinel || !scroll) return;

    const observer = new IntersectionObserver(onIntersect, {
      root:       scroll,
      rootMargin: '200px', // trigger before sentinel is fully in view
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onIntersect]);

  if (isLoading) {
    return <div className="skeleton h-32 rounded-md" />;
  }

  const firstPage = data?.pages[0];
  if (!firstPage?.previewable || firstPage.lines.length === 0) return null;

  const allLines = data!.pages.flatMap(p => p.lines);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Text variant="muted">Preview</Text>
        {hasNextPage && (
          <Badge variant="count" color="dim">{allLines.length} lines</Badge>
        )}
      </div>
      <div
        ref={scrollRef}
        className="overflow-auto rounded-md border border-line"
        style={{ background: 'var(--color-void)', maxHeight: 400 }}
      >
        <pre className="font-mono text-body text-fg-2 p-2 m-0 leading-relaxed">
          <code>{allLines.join('\n')}</code>
        </pre>

        {/* Sentinel — IntersectionObserver fires 200px before this enters view */}
        <div ref={sentinelRef} style={{ height: 1 }} />

        {isFetchingNextPage && (
          <div className="px-2 pb-2 flex flex-col gap-1">
            <div className="skeleton h-3.5 rounded" style={{ width: '70%' }} />
            <div className="skeleton h-3.5 rounded" style={{ width: '50%' }} />
            <div className="skeleton h-3.5 rounded" style={{ width: '60%' }} />
          </div>
        )}
      </div>
    </div>
  );
}
