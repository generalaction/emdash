import { type ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

export function ListPopoverCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="absolute bottom-4 left-6 right-6">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-border bg-background-1 px-3 py-2 text-sm',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
