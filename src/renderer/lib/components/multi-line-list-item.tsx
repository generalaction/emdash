import { cn } from '@renderer/utils/utils';

export function MultiLineListItem({
  children,
  isLast,
  className,
}: {
  children: React.ReactNode;
  isLast: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 border-b border-border py-1', isLast && 'border-b-0')}>
      <div
        className={cn(
          'flex relative items-start gap-3 rounded-lg p-3 py-4 hover:bg-background-1 transition-colors group',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
