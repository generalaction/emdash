import * as React from 'react';
import { cn } from '../lib/cn';
import { inputVariants, type InputVariantProps } from '../recipes/input';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** Match the visual size token from inputVariants (height constraint is dropped for auto-grow). */
  size?: InputVariantProps['size'];
}

function Textarea({ className, size = 'base', ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        inputVariants({ size }),
        // Auto-grow; override the fixed height from inputVariants
        'h-auto field-sizing-content min-h-16 py-2',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
