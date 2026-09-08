import { cx } from '@styles/index';
import { fieldControl } from '@styles/recipes/field-control';
import * as React from 'react';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';
import { textareaOverride } from './textarea.css';

export interface TextareaProps extends Omit<React.ComponentProps<'textarea'>, 'size'> {
  /**
   * Applies caller-owned classes to the rendered textarea root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Shared text-entry size. @default 'base' */
  size?: FieldControlSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
}

/**
 * Multiline text-entry control using the public field-control styling
 * contract. `className` is applied to the rendered textarea root.
 */
function Textarea({ className, size = 'base', tone = 'neutral', ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      data-size={size}
      data-tone={tone}
      className={cx(fieldControl({ size, tone }), textareaOverride, className)}
      {...props}
    />
  );
}

export { Textarea };
