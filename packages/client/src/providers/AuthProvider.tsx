import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { AuthContext, type AuthUser } from '../hooks/useAuth';
import { apiFetch, getToken, setToken, clearToken } from '../lib/api';

const DEV_MODE = import.meta.env.DEV && !import.meta.env.VITE_GOOGLE_CLIENT_ID;

const DEV_USER: AuthUser = {
  id: 'dev-user',
  email: 'dev@localhost',
  name: 'Dev User',
  picture: null,
};

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(DEV_MODE ? DEV_USER : null);
  const [loading, setLoading] = useState(!DEV_MODE);

  // Check existing token on mount
  useEffect(() => {
    if (DEV_MODE) return;
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(data => setUser(data))
      .catch(() => { clearToken(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  // Listen for 401s from apiFetch and clear user state
  useEffect(() => {
    if (DEV_MODE) return;
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
    const data = await res.json() as AuthUser & { token: string };
    setToken(data.token);
    setUser({ id: data.id, email: data.email, name: data.name, picture: data.picture });
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext value={{ user, loading, login, logout }}>
      {children}
    </AuthContext>
  );
}
