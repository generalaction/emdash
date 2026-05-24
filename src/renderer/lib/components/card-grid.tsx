import type { ComponentProps } from 'react';
import { cn } from '@renderer/utils/utils';
import { MicroLabel } from '../ui/label';

export function CardGrid({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', className)} {...props}>
      {children}
    </div>
  );
}

export function CardGridSection({ children, title }: ComponentProps<'div'> & { title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <MicroLabel>{title}</MicroLabel>

      <CardGrid>{children}</CardGrid>
    </div>
  );
}

export function CardGridItem({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-background-1 hover:bg-background-2 p-4 text-left text-card-foreground transition-all',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
