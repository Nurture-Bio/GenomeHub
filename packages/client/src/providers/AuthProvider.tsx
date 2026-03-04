import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { AuthContext, type AuthUser } from '../hooks/useAuth';
import { apiFetch, getToken, setToken, clearToken } from '../lib/api';

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Check existing token on mount
  useEffect(() => {
    // Dev bypass: if VITE_DEV_AUTH_TOKEN is set, skip Google OAuth and use it directly.
    const devToken = import.meta.env.VITE_DEV_AUTH_TOKEN as string | undefined;
    if (devToken) {
      setToken(devToken);
      setUser({ id: 'dev', email: 'dev@local', name: 'Dev User', picture: null });
      setLoading(false);
      return;
    }

    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data))
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Listen for 401s from apiFetch and clear user state
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  const login = useCallback(async (accessToken: string) => {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(body.error ?? 'Login failed');
    }
    const data = (await res.json()) as AuthUser & { token: string };
    setToken(data.token);
    setUser({ id: data.id, email: data.email, name: data.name, picture: data.picture });
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clearToken();
    setUser(null);
  }, []);

  return <AuthContext value={{ user, loading, login, logout }}>{children}</AuthContext>;
}
