import { useState, useEffect, useCallback, type DependencyList } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';

// ─── useApiQuery ──────────────────────────────────────────

export function useApiQuery<T>(url: string | null, deps: DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    if (!url) { setIsLoading(false); return; }
    setIsLoading(true);
    apiFetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

// ─── useApiMutation ──────────────────────────────────────

interface MutationOptions {
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: () => void;
}

export function useApiMutation<TArgs extends unknown[], TReturn = void>(
  buildRequest: (...args: TArgs) => { url: string; init?: RequestInit },
  opts: MutationOptions = {},
) {
  const [pending, setPending] = useState(false);

  const mutate = useCallback(async (...args: TArgs): Promise<TReturn> => {
    setPending(true);
    try {
      const { url, init } = buildRequest(...args);
      const r = await apiFetch(url, init);
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error ?? opts.errorMessage ?? 'Request failed');
      }
      const contentType = r.headers.get('content-type');
      const data = contentType?.includes('application/json') ? await r.json() : undefined;
      opts.onSuccess?.();
      if (opts.successMessage) toast.success(opts.successMessage);
      return data as TReturn;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (opts.errorMessage ?? 'Request failed'));
      throw err;
    } finally {
      setPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildRequest, opts.onSuccess, opts.successMessage, opts.errorMessage]);

  return { mutate, pending };
}
