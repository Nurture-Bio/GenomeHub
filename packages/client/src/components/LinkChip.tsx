import ServiceIcon from './ServiceIcon';
import { Text, chip, iconAction } from '../ui';

interface LinkChipProps {
  url: string;
  label: string | null;
  service: string;
  onDelete?: () => void;
}

export default function LinkChip({ url, label, service, onDelete }: LinkChipProps) {
  const displayLabel = label || new URL(url).hostname.replace(/^www\./, '');

  return (
    <span className="inline-flex items-center gap-1 bg-surface-2 border border-border rounded-sm px-1.5 py-0.5 group/chip">
      <ServiceIcon service={service} size={14} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline hover:text-text transition-colors duration-fast truncate max-w-32"
      >
        <Text variant="caption" className="text-text-secondary">{displayLabel}</Text>
      </a>
      {onDelete && (
        <button
          onClick={e => { e.preventDefault(); onDelete(); }}
          className={iconAction({ color: 'danger' }) + ' opacity-0 group-hover/chip:opacity-100'}
          style={{ fontSize: 'var(--font-size-micro)' }}
        >
          ×
        </button>
      )}
    </span>
  );
}
