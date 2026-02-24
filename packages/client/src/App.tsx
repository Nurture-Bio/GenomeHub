import type { ReactNode } from 'react';
import { useState } from 'react';
import { Routes, Route, NavLink, Navigate, useParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { cx } from 'class-variance-authority';
import { navLink, statusDot, button, input, modalOverlay } from './ui/recipes';
import { Text, Heading, iconAction, ComboBox } from './ui';
import type { ComboBoxItem } from './ui';
import { useAuth } from './hooks/useAuth';
import {
  useEnginesQuery,
  useEngineMethodsQuery,
  useRunMethodMutation,
  useFilesQuery,
} from './hooks/useGenomicQueries';
import type { EngineMethod, EngineStatus } from './hooks/useGenomicQueries';
import LoginPage            from './pages/LoginPage';
import DashboardPage        from './pages/DashboardPage';
import FilesPage            from './pages/FilesPage';
import UploadPage           from './pages/UploadPage';
import OrganismsPage        from './pages/OrganismsPage';
import CollectionsPage      from './pages/CollectionsPage';
import CollectionDetailPage from './pages/CollectionDetailPage';
import FileDetailPage       from './pages/FileDetailPage';
import SettingsPage         from './pages/SettingsPage';

import PageErrorBoundary    from './components/PageErrorBoundary';
import Breadcrumbs          from './components/Breadcrumbs';
import GlobalUploadProgress from './components/GlobalUploadProgress';
import ConfirmDialog        from './components/ConfirmDialog';

// ── Hub icon ─────────────────────────────────────────────
const GenomicIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
    style={{ color: 'var(--color-cyan)' }}>
    {/* Center node */}
    <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    {/* Spokes */}
    <line x1="12" y1="8.5" x2="12" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="15.1" y1="13.8" x2="19" y2="16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="8.9" y1="13.8" x2="5" y2="16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="14.5" y1="10.2" x2="19" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="9.5" y1="10.2" x2="5" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    {/* Outer nodes */}
    <circle cx="12" cy="3" r="1.8" fill="currentColor" opacity="0.5" />
    <circle cx="19.5" cy="17" r="1.8" fill="currentColor" opacity="0.5" />
    <circle cx="4.5" cy="17" r="1.8" fill="currentColor" opacity="0.5" />
    <circle cx="19.5" cy="6.5" r="1.8" fill="currentColor" opacity="0.5" />
    <circle cx="4.5" cy="6.5" r="1.8" fill="currentColor" opacity="0.5" />
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
  organisms: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  collections: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <path d="M9 3h6v7l4 9H5l4-9V3z" />
      <path d="M9 3h6" />
    </svg>
  ),
  settings: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
};

const NAV_ITEMS: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: '/',             label: 'Dashboard',    icon: 'dashboard', end: true },
  { to: '/organisms',    label: 'Organisms',    icon: 'organisms' },
  { to: '/collections',  label: 'Collections',  icon: 'collections' },
  { to: '/files',        label: 'Files',        icon: 'files' },
  { to: '/upload',       label: 'Upload',       icon: 'upload' },
  { to: '/settings',     label: 'Settings',     icon: 'settings' },
];

// ── Sidebar content (shared between desktop static + mobile drawer) ──

function SidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-3 py-3 border-b border-line shrink-0">
      <GenomicIcon />
      <Heading as="span" level="subheading" className="font-bold">GenomeHub</Heading>
    </div>
  );
}

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
              isActive && 'bg-base'
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

// ── Schema-driven method form ─────────────────────────────

function MethodForm({ engineId, method }: { engineId: string; method: EngineMethod }) {
  const { data: files } = useFilesQuery();
  const { runMethod, pending } = useRunMethodMutation();
  const [params, setParams] = useState<Record<string, string>>({});

  const fileItems: ComboBoxItem[] = (files ?? [])
    .filter(f => f.status === 'ready')
    .map(f => ({ id: f.id, label: f.filename, description: f.format }));

  const allRequiredFilled = method.parameters
    .filter(p => p.required)
    .every(p => params[p.name]);

  const handleRun = () => {
    runMethod({ engineId, methodId: method.id, params });
  };

  return (
    <div className="flex flex-col gap-2 py-2 border-t border-line">
      <div>
        <Text variant="body" className="font-semibold">{method.name}</Text>
        <Text variant="dim" as="div" className="mt-0.5">{method.description}</Text>
      </div>

      {method.parameters.map(p => (
        <div key={p.name} className="flex flex-col gap-0.5">
          <Text variant="muted">{p.name.replace(/_/g, ' ')}{p.required ? '' : ' (optional)'}</Text>
          {(p.type === 'track' || p.type === 'genome') ? (
            <ComboBox
              items={fileItems}
              value={params[p.name] ?? ''}
              onValueChange={v => setParams(prev => ({ ...prev, [p.name]: v }))}
              placeholder={p.description}
              size="sm"
            />
          ) : (
            <input
              className={input({ variant: 'default', size: 'sm' })}
              placeholder={p.default ?? p.description}
              value={params[p.name] ?? ''}
              onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
            />
          )}
        </div>
      ))}

      <button
        className={cx(button({ intent: 'primary', size: 'sm', pending }), 'mt-1')}
        disabled={!allRequiredFilled || pending}
        onClick={handleRun}
      >
        {pending ? 'Running...' : 'Run'}
      </button>
    </div>
  );
}

// ── Engine method dialog ──────────────────────────────────

function EngineMethodDialog({
  engine,
  open,
  onOpenChange,
}: {
  engine: EngineStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: methods, isLoading } = useEngineMethodsQuery(open ? engine.id : undefined);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={modalOverlay()} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-modal
                     bg-elevated border border-line rounded-lg shadow-lg
                     p-3 w-full max-w-embed mx-2 max-h-[80vh] overflow-y-auto animate-fade-in"
          onPointerDownOutside={() => onOpenChange(false)}
        >
          <Dialog.Title asChild>
            <Heading level="subheading" className="mb-1">{engine.name}</Heading>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="dim">Available methods from this engine</Text>
          </Dialog.Description>

          {isLoading && <Text variant="dim" className="py-3">Loading methods...</Text>}

          {methods?.length === 0 && (
            <Text variant="dim" className="py-3">No methods available</Text>
          )}

          {methods?.map(m => (
            <MethodForm key={m.id} engineId={engine.id} method={m} />
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Engine list (interactive) ─────────────────────────────

function EngineList() {
  const { data: engines } = useEnginesQuery();
  const running = engines?.filter(e => e.status === 'ok');
  const [selectedEngine, setSelectedEngine] = useState<EngineStatus | null>(null);

  if (!running?.length) return null;
  return (
    <>
      <div className="flex flex-col gap-0.5 px-3 py-1.5 border-t border-line">
        <Text variant="muted">Engines</Text>
        {running.map(e => (
          <button
            key={e.id}
            onClick={() => setSelectedEngine(e)}
            className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-left hover:opacity-80 transition-opacity"
          >
            <div className={statusDot({ status: 'connected', size: 'sm' })} />
            <Text variant="dim">{e.name}</Text>
          </button>
        ))}
      </div>

      {selectedEngine && (
        <EngineMethodDialog
          engine={selectedEngine}
          open={!!selectedEngine}
          onOpenChange={open => { if (!open) setSelectedEngine(null); }}
        />
      )}
    </>
  );
}

function SidebarFooter({ user, logout }: { user: { name: string; email: string; picture?: string | null }; logout: () => void }) {
  return (
    <div className="px-3 py-2 border-t border-line flex items-center gap-2">
      {user.picture ? (
        <img
          src={user.picture}
          alt=""
          referrerPolicy="no-referrer"
          className="w-6 h-6 rounded-full shrink-0"
        />
      ) : (
        <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-body font-bold"
          style={{ background: 'var(--color-cyan)', color: 'var(--color-void)' }}>
          {user.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <Text as="div" variant="dim" className="text-fg truncate">{user.name}</Text>
        <Text as="div" variant="dim" className="text-fg-3 truncate">{user.email}</Text>
      </div>
      <button
        onClick={logout}
        className={cx(iconAction({ color: 'dim' }), 'shrink-0 p-1 min-h-5.5 min-w-5.5 flex items-center justify-center')}
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

function LegacyCollectionRedirect() {
  const { collectionId } = useParams<{ collectionId: string }>();
  return <Navigate to={`/collections/${collectionId}`} replace />;
}

// ── App ───────────────────────────────────────────────────

export default function App() {
  const { user, loading, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full"
        style={{ background: 'var(--color-void)' }}>
        <Text variant="body" className="text-fg-3">Loading...</Text>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="flex flex-col md:flex-row h-full" style={{ background: 'var(--color-void)' }}>

      {/* Mobile top bar */}
      <header
        className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-line shrink-0"
        style={{ background: 'var(--color-void)' }}
      >
        <GenomicIcon />
        <Heading as="span" level="subheading" className="font-bold flex-1">GenomeHub</Heading>
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={cx(iconAction({ color: 'dim' }), 'flex items-center justify-center min-h-5.5 min-w-5.5')}
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer — Radix Dialog gives us focus trap + escape key for free */}
      <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-20 animate-fade-in" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-line animate-slide-in-left"
            style={{ width: 200, background: 'var(--color-void)' }}
            aria-label="Navigation"
          >
            <SidebarBrand />
            <SidebarNav onNavClick={() => setMobileMenuOpen(false)} />
            <EngineList />
            <SidebarFooter user={user} logout={logout} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Desktop sidebar — static, in normal flex flow */}
      <aside
        className="hidden md:flex flex-col shrink-0 border-r border-line"
        style={{ width: 200, background: 'var(--color-void)' }}
      >
        <SidebarBrand />
        <SidebarNav />
        <EngineList />
        <SidebarFooter user={user} logout={logout} />
      </aside>

      {/* Global dialogs */}
      <ConfirmDialog />
      <GlobalUploadProgress />

      {/* Main */}
      <main className="flex-1 overflow-auto min-w-0" style={{ scrollbarGutter: 'stable' }}>
        <Breadcrumbs />
        <Routes>
          <Route path="/" element={<PageErrorBoundary><DashboardPage /></PageErrorBoundary>} />
          <Route path="/organisms" element={<PageErrorBoundary><OrganismsPage /></PageErrorBoundary>} />
          <Route path="/collections" element={<PageErrorBoundary><CollectionsPage /></PageErrorBoundary>} />
          <Route path="/files" element={<PageErrorBoundary><FilesPage /></PageErrorBoundary>} />
          <Route path="/files/:fileId" element={<PageErrorBoundary><FileDetailPage /></PageErrorBoundary>} />
          <Route path="/upload" element={<PageErrorBoundary><UploadPage /></PageErrorBoundary>} />
          <Route path="/settings" element={<PageErrorBoundary><SettingsPage /></PageErrorBoundary>} />
          <Route path="/collections/:collectionId" element={<PageErrorBoundary><CollectionDetailPage /></PageErrorBoundary>} />
          {/* Legacy redirects */}
          <Route path="/experiments/:collectionId" element={<LegacyCollectionRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
