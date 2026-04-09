import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@renderer/lib/utils';

interface ButtonCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

export const ButtonCard = forwardRef<HTMLButtonElement, ButtonCardProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'w-full border border-border rounded-md p-4 hover:bg-muted/30 transition-colors flex flex-col items-center justify-center gap-2 data-active:shadow-sm data-active:text-primary text-muted-foreground data-active:bg-muted/40 data-active:border-primary/40',
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

export function ButtonCardGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex flex-col gap-2', className)}>{children}</div>;
}
