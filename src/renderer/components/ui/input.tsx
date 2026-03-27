import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';
import { cn } from '@renderer/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 hover:border-border-2 rounded-md border border-border-1 bg-transparent px-2.5 py-1 text-sm transition-[color,box-shadow] outline-none placeholder:text-foreground-passive focus-visible:border focus-visible:border-border-primary focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className
      )}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
      }}
      {...props}
    />
  );
}

export { Input };
