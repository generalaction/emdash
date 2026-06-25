import { inputVariants, type InputVariantProps } from '@styles/recipes/input';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { textareaOverride } from './textarea.css';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** Match the visual size token from inputVariants (height constraint is dropped for auto-grow). */
  size?: InputVariantProps['size'];
}

function Textarea({ className, size = 'base', ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cx(inputVariants({ size }), textareaOverride, className)}
      {...props}
    />
  );
}

export { Textarea };
