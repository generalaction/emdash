import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';
import { cn } from '../lib/cn';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function Input(
  { className, type, ...props },
  ref
) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      ref={ref}
      className={cn(
        'h-8 w-full min-w-0 hover:border-border-1 rounded-md border focus-visible:ring-2 focus-visible:ring-border-primary/30 border-border bg-transparent px-2.5 py-1 text-sm transition-[color,box-shadow] outline-none [color-scheme:light] placeholder:text-foreground-passive focus-visible:border focus-visible:border-border-primary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-border-destructive aria-invalid:ring-3 aria-invalid:ring-border-destructive/20 md:text-sm',
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
});

export { Input };
