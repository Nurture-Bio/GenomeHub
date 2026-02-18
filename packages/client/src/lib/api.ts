/**
 * Thin wrapper around fetch() for /api/ calls.
 * On 401, reloads the page so AuthProvider re-checks and shows LoginPage.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.location.reload();
    // Return the response anyway so callers don't hang
    return res;
  }
  return res;
}
