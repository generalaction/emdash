import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@renderer/utils/utils';

const alertVariants = cva(
  'group/alert relative grid w-full gap-0.5 rounded-lg px-4 py-3 text-left text-sm',
  {
    variants: {
      variant: {
        default: 'bg-card text-foreground',
        destructive:
          'bg-background-destructive text-foreground-destructive *:data-[slot=alert-description]:text-foreground-destructive/80',
        warning:
          'bg-background-warning text-foreground-warning *:data-[slot=alert-description]:text-foreground-warning/80',
        success:
          'bg-background-success text-foreground-success *:data-[slot=alert-description]:text-foreground-success/80',
        info: 'bg-background-info text-foreground-info *:data-[slot=alert-description]:text-foreground-info/80',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'flex items-center gap-1.5 text-sm  [&_svg]:size-4 [&_svg]:shrink-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-xs text-balance text-foreground-muted md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="alert-action"
      className={cn(
        'mt-0.5 w-fit text-xs font-medium text-current underline underline-offset-3 hover:opacity-80 disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
