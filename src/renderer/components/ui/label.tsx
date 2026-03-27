import * as React from 'react';
import { cn } from '@renderer/lib/utils';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm font-normal  tracking-tight leading-none text-foreground-muted select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function MicroLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'cursor-default uppercase font-mono tracking-widest select-none text-xs',
        className
      )}
      {...props}
    />
  );
}

export { Label };
