import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-300 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:border-border dark:focus-visible:ring-gray-600',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
