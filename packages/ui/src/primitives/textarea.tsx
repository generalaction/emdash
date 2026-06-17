import * as React from 'react';
import { cn } from '../lib/cn';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm transition-[color,box-shadow] outline-none placeholder:text-foreground-passive hover:border-border-1 focus-visible:border focus-visible:border-border-primary focus-visible:ring-2 focus-visible:ring-border-primary/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-border-destructive aria-invalid:ring-3 aria-invalid:ring-border-destructive/20 md:text-sm',
        className
      )}
      {...props}
    />
  );
}

export type TextareaProps = React.ComponentProps<'textarea'>;

export { Textarea };
