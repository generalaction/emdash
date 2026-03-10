import { ButtonHTMLAttributes } from 'react';
import { cn } from '@renderer/lib/utils';

export function ButtonCard({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'w-full border border-border rounded-md p-4 hover:bg-muted/20 transition-colors flex flex-col items-center justify-center gap-2',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonCardGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex flex-col gap-2', className)}>{children}</div>;
}
