import { Input as InputPrimitive } from '@base-ui/react/input';
import { inputVariants, type InputVariantProps } from '@styles/recipes/input';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';

export interface InputProps
  extends Omit<React.ComponentProps<'input'>, 'size'>, InputVariantProps {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, size = 'base', ...props },
  ref
) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      ref={ref}
      className={cx(inputVariants({ size }), className)}
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
