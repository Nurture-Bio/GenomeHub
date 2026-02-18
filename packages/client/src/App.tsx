import type { ReactNode } from 'react';
import { Routes, Route, NavLink, Navigate, useParams } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import { navLink } from './ui/recipes';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './stores/useAppStore';
import LoginPage            from './pages/LoginPage';
import DashboardPage        from './pages/DashboardPage';
import FilesPage            from './pages/FilesPage';
import UploadPage           from './pages/UploadPage';
import OrganismsPage        from './pages/OrganismsPage';
import ProjectsPage         from './pages/ProjectsPage';
import ExperimentsPage      from './pages/ExperimentsPage';
import ProjectDetailPage    from './pages/ProjectDetailPage';
import ExperimentDetailPage from './pages/ExperimentDetailPage';
import DatasetDetailPage    from './pages/DatasetDetailPage';
import PageErrorBoundary    from './components/PageErrorBoundary';
import Breadcrumbs          from './components/Breadcrumbs';

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

const icons: Record<string, ReactNode> = {
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
  projects: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
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

const NAV_ITEMS: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: '/',            label: 'Dashboard',   icon: 'dashboard', end: true },
  { to: '/projects',    label: 'Projects',    icon: 'projects' },
  { to: '/organisms',   label: 'Organisms',   icon: 'organisms' },
  { to: '/experiments', label: 'Experiments', icon: 'experiments' },
  { to: '/files',       label: 'Files',       icon: 'files' },
  { to: '/upload',      label: 'Upload',      icon: 'upload' },
];

// ── Sidebar content (shared between desktop static + mobile drawer) ──

function SidebarNav({ onNavClick }: { onNavClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 p-1.5 flex-1">
      {NAV_ITEMS.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavClick}
          className={({ isActive }) =>
            cx(
              navLink({ active: isActive }),
              'rounded-sm gap-2 w-full text-left border-none cursor-pointer bg-transparent no-underline min-h-5.5',
              isActive && 'bg-surface'
            )
          }
        >
          {icons[item.icon]}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarFooter({ user, logout }: { user: { name: string; email: string; picture?: string | null }; logout: () => void }) {
  return (
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
        className="shrink-0 text-text-dim hover:text-text cursor-pointer bg-transparent border-none p-1 min-h-5.5 min-w-5.5 flex items-center justify-center"
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
  );
}

// ── Legacy redirects ──────────────────────────────────────

function LegacyExperimentRedirect() {
  const { experimentId } = useParams<{ experimentId: string }>();
  return <Navigate to={`/experiments/${experimentId}`} replace />;
}

function LegacySampleRedirect() {
  const { experimentId, sampleId } = useParams<{ experimentId: string; sampleId: string }>();
  return <Navigate to={`/experiments/${experimentId}/datasets/${sampleId}`} replace />;
}

// ── App ───────────────────────────────────────────────────

export default function App() {
  const { user, loading, logout } = useAuth();
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full"
        style={{ background: 'var(--color-bg)' }}>
        <div className="font-body text-body text-text-dim">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const closeSidebar = () => { if (sidebarOpen) toggleSidebar(); };

  return (
    <div className="flex flex-col md:flex-row h-full" style={{ background: 'var(--color-bg)' }}>
      {/* Mobile top bar — visible below md */}
      <header
        className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-border shrink-0"
        style={{ background: 'var(--color-bg-deep)' }}
      >
        <GenomicIcon />
        <span className="font-display font-bold text-subheading text-accent flex-1">
          GenomeHub
        </span>
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center min-h-5.5 min-w-5.5 bg-transparent border-none cursor-pointer text-text-secondary hover:text-text"
          aria-label="Toggle menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      {/* Mobile backdrop — visible below md when sidebar open */}
      <div
        className={cx(
          'fixed inset-0 z-20 bg-black/50 transition-opacity duration-fast md:hidden',
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={closeSidebar}
      />

      {/* Sidebar — fixed drawer on mobile, static on md+ */}
      <aside
        className={cx(
          'flex flex-col shrink-0 border-r border-border',
          // Mobile: fixed drawer from left
          'fixed inset-y-0 left-0 z-30 transition-transform duration-fast',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static sidebar, always visible
          'md:static md:translate-x-0 md:z-auto'
        )}
        style={{ width: 200, background: 'var(--color-bg-deep)' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-border-subtle">
          <GenomicIcon />
          <span className="font-display font-bold text-subheading text-accent">
            GenomeHub
          </span>
        </div>

        {/* Nav — close sidebar on mobile nav click */}
        <SidebarNav onNavClick={closeSidebar} />

        {/* Footer — user info */}
        <SidebarFooter user={user} logout={logout} />
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto min-w-0">
        <Breadcrumbs />
        <Routes>
          <Route path="/" element={<PageErrorBoundary><DashboardPage /></PageErrorBoundary>} />
          <Route path="/projects" element={<PageErrorBoundary><ProjectsPage /></PageErrorBoundary>} />
          <Route path="/organisms" element={<PageErrorBoundary><OrganismsPage /></PageErrorBoundary>} />
          <Route path="/experiments" element={<PageErrorBoundary><ExperimentsPage /></PageErrorBoundary>} />
          <Route path="/files" element={<PageErrorBoundary><FilesPage /></PageErrorBoundary>} />
          <Route path="/upload" element={<PageErrorBoundary><UploadPage /></PageErrorBoundary>} />
          <Route path="/projects/:projectId" element={<PageErrorBoundary><ProjectDetailPage /></PageErrorBoundary>} />
          <Route path="/experiments/:experimentId" element={<PageErrorBoundary><ExperimentDetailPage /></PageErrorBoundary>} />
          <Route path="/experiments/:experimentId/datasets/:datasetId" element={<PageErrorBoundary><DatasetDetailPage /></PageErrorBoundary>} />
          {/* Legacy redirects */}
          <Route path="/projects/:projectId/experiments/:experimentId" element={<LegacyExperimentRedirect />} />
          <Route path="/projects/:projectId/experiments/:experimentId/samples/:sampleId" element={<LegacySampleRedirect />} />
          <Route path="/experiments/:experimentId/samples/:sampleId" element={<LegacySampleRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
