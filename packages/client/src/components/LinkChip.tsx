import ServiceIcon from './ServiceIcon';
import { Text } from '../ui';

interface LinkChipProps {
  url: string;
  label: string | null;
  service: string;
  onDelete?: () => void;
}

export default function LinkChip({ url, label, service, onDelete }: LinkChipProps) {
  const displayLabel = label || new URL(url).hostname.replace(/^www\./, '');

  return (
    <span className="inline-flex items-center gap-1 bg-surface-raised border border-border rounded-sm px-1.5 py-0.5 group/chip">
      <ServiceIcon service={service} size={14} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline hover:text-text transition-colors duration-fast truncate max-w-32"
      >
        <Text variant="dim" className="text-text-muted">
          {displayLabel}
        </Text>
      </a>
      {onDelete && (
        <button
          type="button"
          aria-label="Remove link"
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
          className="size-3.5 shrink-0 flex items-center justify-center rounded-full
                     opacity-0 group-hover/chip:opacity-100
                     transition-opacity duration-fast
                     text-text-faint hover:text-danger hover:bg-black/15
                     cursor-pointer border-0 bg-transparent font-sans text-body leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
}
