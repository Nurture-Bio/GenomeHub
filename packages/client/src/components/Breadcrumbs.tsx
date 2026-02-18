import { Link, useLocation } from 'react-router-dom';
import { Text } from '../ui';

const ROUTE_LABELS: Record<string, string> = {
  '': 'Dashboard',
  organisms: 'Organisms',
  experiments: 'Experiments',
  files: 'Files',
  upload: 'Upload',
  projects: 'Projects',
  samples: 'Samples',
};

export default function Breadcrumbs() {
  const { pathname } = useLocation();
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
      // Param-based segment — label it with context from previous segment
      const prev = segments[i - 1];
      const context = prev === 'projects' ? 'Project'
        : prev === 'experiments' ? 'Experiment'
        : prev === 'samples' ? 'Sample'
        : seg;
      crumbs.push({ label: `${context} ${seg.slice(0, 8)}`, to: path });
    }
  }

  return (
    <nav className="flex items-center gap-1 px-3 pt-2 pb-0">
      {crumbs.map((crumb, i) => (
        <span key={crumb.to} className="flex items-center gap-1">
          {i > 0 && <Text variant="caption">&gt;</Text>}
          {i < crumbs.length - 1 ? (
            <Link
              to={crumb.to}
              className="no-underline text-text-dim font-body text-caption hover:text-text transition-colors duration-fast"
            >
              {crumb.label}
            </Link>
          ) : (
            <Text variant="caption" className="text-text">{crumb.label}</Text>
          )}
        </span>
      ))}
    </nav>
  );
}
