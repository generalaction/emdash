import { X } from 'lucide-react';

interface ListFilterPillProps {
  label: string;
  avatarUrl?: string;
  color?: string;
  onRemove: () => void;
}

export function ListFilterPill({ avatarUrl, color, label, onRemove }: ListFilterPillProps) {
  return (
    <span className="bg-muted inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
      {avatarUrl ? <img src={avatarUrl} alt={label} className="size-3.5 rounded-full" /> : null}
      {color ? (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `#${color}` }} />
      ) : null}
      {label}
      <button
        type="button"
        className="text-muted-foreground ml-0.5 rounded-full hover:text-foreground"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}
