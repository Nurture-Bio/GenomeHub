import ServiceIcon from './ServiceIcon';

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
        className="font-body text-micro text-text-secondary no-underline hover:text-text transition-colors duration-fast truncate max-w-32"
      >
        {displayLabel}
      </a>
      {onDelete && (
        <button
          onClick={e => { e.preventDefault(); onDelete(); }}
          className="opacity-0 group-hover/chip:opacity-100 bg-transparent border-none cursor-pointer text-text-dim hover:text-red text-micro px-0 transition-opacity duration-fast"
        >
          ×
        </button>
      )}
    </span>
  );
}
