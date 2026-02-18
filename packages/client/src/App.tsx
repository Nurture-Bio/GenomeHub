import { useState } from 'react';
import { cx } from 'class-variance-authority';
import { navLink } from './ui/recipes';
import { useAuth } from './hooks/useAuth';
import LoginPage       from './pages/LoginPage';
import DashboardPage   from './pages/DashboardPage';
import FilesPage       from './pages/FilesPage';
import UploadPage      from './pages/UploadPage';
import OrganismsPage   from './pages/OrganismsPage';
import ExperimentsPage from './pages/ExperimentsPage';

// ── DNA helix icon ────────────────────────────────────────
const GenomicIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
    style={{ color: 'var(--color-accent)' }}>
    <path d="M7 3c0 0 1 2 5 2s5 2 5 2" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" />
    <path d="M17 3c0 0-1 2-5 2S7 7 7 7" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" />
    <path d="M7 12c0 0 1 2 5 2s5 2 5 2" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" />
    <path d="M17 12c0 0-1 2-5 2s-5 2-5 2" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" />
    <path d="M7 3v18M17 3v18" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeDasharray="2 3" />
  </svg>
);

// ── Navigation icons ──────────────────────────────────────

const icons = {
  dashboard: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  files: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  upload: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
  ),
  organisms: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  experiments: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <path d="M9 3h6v7l4 9H5l4-9V3z" />
      <path d="M9 3h6" />
    </svg>
  ),
};

type Page = 'dashboard' | 'files' | 'upload' | 'organisms' | 'experiments';

const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: 'dashboard',   label: 'Dashboard' },
  { id: 'organisms',   label: 'Organisms' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'files',       label: 'Files' },
  { id: 'upload',      label: 'Upload' },
];

// ── App ───────────────────────────────────────────────────

export default function App() {
  const { user, loading, logout } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full"
        style={{ background: 'var(--color-bg)' }}>
        <div className="font-body text-body text-text-dim">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="flex h-full" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <aside className="flex flex-col shrink-0 border-r border-border"
        style={{ width: 200, background: 'var(--color-bg-deep)' }}>

        {/* Brand */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-border-subtle">
          <GenomicIcon />
          <span className="font-display font-bold text-subheading text-accent">
            GenomeHub
          </span>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 p-1.5 flex-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={cx(
                navLink({ active: page === item.id }),
                'rounded-sm gap-2 w-full text-left border-none cursor-pointer bg-transparent',
                page === item.id && 'bg-surface'
              )}
            >
              {icons[item.id]}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Footer — user info */}
        <div className="px-3 py-2 border-t border-border-subtle flex items-center gap-2">
          {user.picture ? (
            <img
              src={user.picture}
              alt=""
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full shrink-0"
            />
          ) : (
            <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-micro font-bold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-bg)' }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-body text-micro text-text truncate">{user.name}</div>
            <div className="font-mono text-micro text-text-dim truncate">{user.email}</div>
          </div>
          <button
            onClick={logout}
            className="shrink-0 text-text-dim hover:text-text cursor-pointer bg-transparent border-none p-0.5"
            title="Sign out"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {page === 'dashboard'   && <DashboardPage />}
        {page === 'organisms'   && <OrganismsPage />}
        {page === 'experiments' && <ExperimentsPage />}
        {page === 'files'       && <FilesPage />}
        {page === 'upload'      && <UploadPage />}
      </main>
    </div>
  );
}
