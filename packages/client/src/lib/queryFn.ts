import { apiFetch } from './api';

export async function fetchApi<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function mutateApi<T = void>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'Request failed');
  }
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json();
  }
  return undefined as T;
}
