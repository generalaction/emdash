import * as React from 'react';
import { cn } from '../lib/cn';
import { inputVariants, type InputVariantProps } from '../../styles/recipes/input';
import { textareaOverride } from './textarea.css';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** Match the visual size token from inputVariants (height constraint is dropped for auto-grow). */
  size?: InputVariantProps['size'];
}

function Textarea({ className, size = 'base', ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(inputVariants({ size }), textareaOverride, className)}
      {...props}
    />
  );
}

export { Textarea };
