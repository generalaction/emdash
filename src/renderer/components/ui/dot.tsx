import { cn } from '@renderer/lib/utils';

export function SeparatorDot({ className }: { className?: string }) {
  return (
    <div className={cn('px-0.5 flex items-center', className)}>
      <span className="inline-block size-0.5 shrink-0 rounded-full bg-foreground-passive" />
    </div>
  );
}
