import { useRef, useEffect, useCallback, useState } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import type { FilePreviewPage } from '../hooks/useGenomicQueries';
import { usePresignedUrl } from '../hooks/useGenomicQueries';
import JsonStrandPreview from './JsonStrandPreview';
import { Text, Badge } from '../ui';

interface FilePreviewProps {
  fileId:   string;
  filename: string;
}

// ── JSON preview: resolves presigned URL then hands off to Strand pipeline ───

function JsonPreview({ fileId }: { fileId: string }) {
  const { getUrl }             = usePresignedUrl();
  const [url,   setUrl]        = useState<string | null>(null);
  const [error, setError]      = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fn = getUrl;
    fn(fileId).then(u => {
      if (!cancelled) setUrl(u);
    }).catch(e => {
      if (!cancelled) setError(String(e));
    });
    return () => { cancelled = true; };
  }, [fileId, getUrl]);

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

export default function FilePreview({ fileId, filename }: FilePreviewProps) {
  const isJson = filename.toLowerCase().endsWith('.json');

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteFilePreview(!isJson ? fileId : undefined);

  if (isJson) {
    return <JsonPreview fileId={fileId} />;
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
