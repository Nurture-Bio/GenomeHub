import { useParams } from 'react-router-dom';
import { useFileDetailQuery } from '../hooks/useGenomicQueries';
import QueryWorkbench from '../components/QueryWorkbench';
import { Heading, Badge } from '../ui';
import { AppLogo } from '../components/AppLogo';

export default function DemoPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const { data: file } = useFileDetailQuery(fileId);

  if (!fileId) return null;

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-void)' }}>
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-white/10 shrink-0">
        <span className="logo-glow">
          <AppLogo size={28} />
        </span>
        <Heading as="span" level="subheading" className="font-display font-bold tracking-tight">
          GenomeHub
        </Heading>
        <Badge variant="count" color="dim">Demo</Badge>
      </header>
      <main className="flex-1 overflow-auto min-w-0" style={{ scrollbarGutter: 'stable' }}>
        <QueryWorkbench fileId={fileId} filename={file?.filename} />
      </main>
    </div>
  );
}
