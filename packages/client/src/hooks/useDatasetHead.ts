/**
 * useDatasetHead — fetch the first N records of a remote dataset.
 *
 * Generic over scanner format: pass a JsonHeadScanner for JSON arrays,
 * or any future scanner (CSV, NDJSON, etc.) that implements DatasetHeadScanner.
 *
 * Lifecycle:
 *   1. fetch(url) with an AbortController
 *   2. Pipe response.body through TextDecoderStream (UTF-8 boundary safety)
 *   3. Feed the text stream to scanner.scan(stream, limit)
 *   4. The moment scan() resolves, abort the fetch (severs the connection)
 *   5. Return the rows to React
 *
 * Memory: O(limit) — only the parsed head rows are held.
 * Network: reads only as many bytes as needed to find `limit` complete records.
 */

import { useState, useEffect, useRef } from 'react';
import type { DatasetHeadScanner, ScanResult } from '../lib/scanners';

export type DatasetHeadStatus = 'idle' | 'loading' | 'done' | 'error';

export interface UseDatasetHeadResult<T = unknown> {
  status: DatasetHeadStatus;
  rows: T[];
  truncated: boolean;
  error: string | null;
}

const EMPTY_ROWS: never[] = [];

export function useDatasetHead<T = unknown>(
  url: string | null,
  scanner: DatasetHeadScanner<T>,
  limit: number = 1_000,
): UseDatasetHeadResult<T> {
  const [status, setStatus] = useState<DatasetHeadStatus>('idle');
  const [result, setResult] = useState<ScanResult<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef(scanner);
  scannerRef.current = scanner;

  useEffect(() => {
    if (!url) return;

    const ac = new AbortController();
    setStatus('loading');
    setResult(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
        if (!res.body) throw new Error('Response has no body');

        // TextDecoderStream guarantees we never split a multi-byte UTF-8
        // codepoint across chunk boundaries.
        const textStream = res.body.pipeThrough(new TextDecoderStream());
        const scanResult = await scannerRef.current.scan(textStream, limit);

        if (!ac.signal.aborted) {
          setResult(scanResult);
          setStatus('done');
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      } finally {
        // Sever the connection — stops the server from streaming the
        // remaining 599 MB we don't need.
        if (!ac.signal.aborted) ac.abort();
      }
    })();

    return () => {
      ac.abort();
    };
  }, [url, limit]);

  return {
    status,
    rows: result?.rows ?? EMPTY_ROWS,
    truncated: result?.truncated ?? false,
    error,
  };
}
