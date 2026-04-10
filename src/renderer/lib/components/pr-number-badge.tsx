import { cn } from '@renderer/utils/utils';

export function PrNumberBadge({ number, className }: { number: number; className?: string }) {
  return (
    <span
      className={cn('font-mono text-xs text-foreground-muted shrink-0 tracking-wide', className)}
    >
      #{number}
    </span>
  );
}
