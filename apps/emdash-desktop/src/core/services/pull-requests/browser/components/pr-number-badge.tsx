import { cn } from '@core/primitives/styling/browser/cn';

export function PrNumberBadge({
  number,
  className,
  provider = 'github',
}: {
  number: number;
  className?: string;
  provider?: string;
}) {
  return (
    <span className={cn('font-sans text-xs text-foreground-muted shrink-0', className)}>
      {provider === 'gitlab' ? '!' : '#'}
      {number}
    </span>
  );
}
