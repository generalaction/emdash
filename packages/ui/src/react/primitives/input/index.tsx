import { Input as InputPrimitive } from '@base-ui/react/input';
import { cx } from '@styles/index';
import { fieldControl } from '@styles/recipes/field-control';
import * as React from 'react';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';

export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  /**
   * Applies caller-owned classes to the rendered input root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Shared text-entry size. @default 'base' */
  size?: FieldControlSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
}

/**
 * Text-entry control using the public field-control styling contract.
 *
 * Native `disabled`, `readOnly`, and `aria-invalid` state drive the shared
 * visual states. `className` is applied to the rendered input root.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, size = 'base', tone = 'neutral', ...props },
  ref
) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={size}
      data-tone={tone}
      ref={ref}
      className={cx(fieldControl({ size, tone }), className)}
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
