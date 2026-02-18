/**
 * Thin wrapper around fetch() for /api/ calls.
 * On 401, dispatches an event so AuthProvider clears user state and shows LoginPage.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'));
  }
  return res;
}
