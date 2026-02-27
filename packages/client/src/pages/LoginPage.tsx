import { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Text, Heading } from '../ui';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

import { AppLogo } from '../components/AppLogo';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

function loadGisScript(): Promise<void> {
  if (typeof google !== 'undefined' && google.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google sign-in'));
    document.head.appendChild(script);
  });
}

export default function LoginPage() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSignIn = useCallback(async () => {
    try {
      setError(null);
      await loadGisScript();

      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        callback: async (response) => {
          if (response.error) {
            setError(response.error_description || response.error);
            setPending(false);
            return;
          }
          try {
            setPending(true);
            await login(response.access_token);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
          } finally {
            setPending(false);
          }
        },
      });

      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Google sign-in');
    }
  }, [login]);

  return (
    <div className="flex items-center justify-center h-full login-bg">
      <div className="flex flex-col items-center gap-4 p-8 rounded-lg border border-line card-surface"
        style={{ width: 380 }}>
        <span className="logo-glow"><AppLogo size={48} /></span>
        <div className="text-center">
          <Heading as="div" level="heading" className="font-bold">
            GenomeHub
          </Heading>
          <Text variant="dim" className="text-lg">Genomic data management for nurture.bio</Text>
        </div>

        <button
          onClick={handleSignIn}
          disabled={pending}
          className="flex items-center gap-3 px-4 py-2.5 rounded-md btn-primary cursor-pointer w-full justify-center"
        >
          <GoogleIcon />
          <span className="font-sans text-body font-bold">
            {pending ? 'Signing in...' : 'Sign in with Google'}
          </span>
        </button>

        {error && (
          <Text variant="error">{error}</Text>
        )}

        <Text variant="caption" className="text-xs">Restricted to nurture.bio accounts</Text>
      </div>
    </div>
  );
}
