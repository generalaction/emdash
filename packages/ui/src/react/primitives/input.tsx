import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';
import { inputVariants, type InputVariantProps } from '../../styles/recipes/input';
import { cn } from '../lib/cn';

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
      className={cn(inputVariants({ size }), className)}
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
