import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Text } from '../ui';
import { useAppStore } from '../stores/useAppStore';

const ROUTE_LABELS: Record<string, string> = {
  '': 'Dashboard',
  organisms: 'Organisms',
  collections: 'Collections',
  files: 'Files',
  upload: 'Upload',
  projects: 'Projects',
};

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const [expanded, setExpanded] = useState(false);
  const breadcrumbLabels = useAppStore(s => s.breadcrumbLabels);
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs: { label: string; to: string }[] = [
    { label: 'Dashboard', to: '/' },
  ];

  let path = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    path += '/' + seg;

    const knownLabel = ROUTE_LABELS[seg];
    if (knownLabel) {
      crumbs.push({ label: knownLabel, to: path });
    } else {
      // Check store for resolved entity name
      const resolved = breadcrumbLabels[seg];
      if (resolved) {
        crumbs.push({ label: resolved, to: path });
      } else {
        const prev = segments[i - 1];
        const context = prev === 'projects' ? 'Project'
          : prev === 'collections' ? 'Collection'
          : prev === 'files' ? 'File'
          : seg;
        crumbs.push({ label: `${context} ${seg.slice(0, 8)}`, to: path });
      }
    }
  }

  // On mobile (handled via CSS): show first, "...", and last when >2 crumbs
  const needsTruncation = crumbs.length > 2;

  return (
    <nav className="flex items-center gap-1 px-2 md:px-3 pt-2 pb-0 min-w-0">
      {crumbs.map((crumb, i) => {
        const isFirst = i === 0;
        const isLast = i === crumbs.length - 1;
        const isMiddle = !isFirst && !isLast;

        // On mobile: hide middle crumbs unless expanded
        const mobileHidden = isMiddle && needsTruncation && !expanded;

        return (
          <span
            key={crumb.to}
            className={`flex items-center gap-1 min-w-0 ${mobileHidden ? 'hidden md:flex' : 'flex'}`}
          >
            {i > 0 && <Text variant="caption" className={mobileHidden ? 'hidden md:inline' : ''}>&gt;</Text>}
            {isLast ? (
              <Text variant="caption" className="text-text truncate">{crumb.label}</Text>
            ) : (
              <Link
                to={crumb.to}
                className="no-underline text-text-dim font-body text-caption hover:text-text transition-colors duration-fast whitespace-nowrap"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}

      {/* Mobile "..." button — only shown when middle crumbs are truncated */}
      {needsTruncation && !expanded && (
        <span className="flex items-center gap-1 md:hidden">
          <Text variant="caption">&gt;</Text>
          <button
            onClick={() => setExpanded(true)}
            className="bg-transparent border-none cursor-pointer text-text-dim hover:text-text font-body text-caption px-0.5 min-h-5.5"
          >
            ...
          </button>
        </span>
      )}
    </nav>
  );
}
