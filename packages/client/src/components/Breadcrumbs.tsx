import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Text, iconAction } from '../ui';
import { useAppStore } from '../stores/useAppStore';

const ROUTE_LABELS: Record<string, string> = {
  '': 'Dashboard',
  organisms: 'Organisms',
  collections: 'Collections',
  files: 'Files',
  upload: 'Upload',
  settings: 'Settings',
  errors: 'Errors',
};

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const [expanded, setExpanded] = useState(false);
  const breadcrumbLabels = useAppStore((s) => s.breadcrumbLabels);
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs: { label: string; to: string }[] = [{ label: 'Dashboard', to: '/' }];

  let path = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    path += '/' + seg;

    const knownLabel = ROUTE_LABELS[seg];
    if (knownLabel) {
      crumbs.push({ label: knownLabel, to: path });
    } else {
      const resolved = breadcrumbLabels[seg];
      if (resolved) {
        crumbs.push({ label: resolved, to: path });
      } else {
        const prev = segments[i - 1];
        const context = prev === 'collections' ? 'Collection' : prev === 'files' ? 'File' : seg;
        crumbs.push({ label: `${context} ${seg.slice(0, 8)}`, to: path });
      }
    }
  }

  const needsTruncation = crumbs.length > 2;

  return (
    <nav className="flex items-center gap-1 px-2 md:px-5 pt-3 pb-0 min-w-0">
      {crumbs.map((crumb, i) => {
        const isFirst = i === 0;
        const isLast = i === crumbs.length - 1;
        const isMiddle = !isFirst && !isLast;
        const mobileHidden = isMiddle && needsTruncation && !expanded;

        return (
          <span
            key={crumb.to}
            className={`flex items-center gap-1 min-w-0 ${mobileHidden ? 'hidden md:flex' : 'flex'}`}
          >
            {i > 0 && (
              <Text variant="dim" className={mobileHidden ? 'hidden md:inline' : ''}>
                &gt;
              </Text>
            )}
            {isLast ? (
              <Text variant="dim" className="text-fg truncate">
                {crumb.label}
              </Text>
            ) : (
              <Link to={crumb.to} className="no-underline">
                <Text
                  variant="dim"
                  className="hover:text-fg transition-colors duration-fast whitespace-nowrap"
                >
                  {crumb.label}
                </Text>
              </Link>
            )}
          </span>
        );
      })}

      {needsTruncation && !expanded && (
        <span className="flex items-center gap-1 md:hidden">
          <Text variant="dim">&gt;</Text>
          <button
            onClick={() => setExpanded(true)}
            className={iconAction({ color: 'dim' }) + ' px-0.5 min-h-5.5'}
          >
            ...
          </button>
        </span>
      )}
    </nav>
  );
}
