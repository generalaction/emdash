import { Button as ButtonPrimitive } from '@base-ui/react/button';
import * as React from 'react';
import { cn } from '../lib/cn';
import { controlVariants, type ControlVariantProps } from '../recipes/control';

export type ButtonProps = ButtonPrimitive.Props &
  ControlVariantProps & {
    /** Square aspect ratio; collapses padding. Combines with size. */
    icon?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', tone = 'neutral', size = 'base', icon = false, ...props },
  ref
) {
  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      className={cn(controlVariants({ variant, tone, size, icon }), className)}
      {...props}
    />
  );
});

export { Button };
