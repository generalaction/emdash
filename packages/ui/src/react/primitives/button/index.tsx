import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { controlVariants, type ControlVariantProps } from '@styles/recipes/control';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';

export type ButtonVariant = NonNullable<ControlVariantProps['variant']> | 'destructive' | 'link';

export type ButtonProps = ButtonPrimitive.Props &
  Omit<ControlVariantProps, 'variant'> & {
    variant?: ButtonVariant;
    /** Square aspect ratio; collapses padding. Combines with size. */
    icon?: boolean;
  };

export function resolveButtonControlVariant({
  variant,
  tone,
  size,
}: {
  variant: ButtonVariant;
  tone: ControlVariantProps['tone'];
  size: ControlVariantProps['size'];
}): ControlVariantProps {
  if (variant === 'destructive') {
    return { variant: 'primary', tone: 'destructive', size };
  }

  if (variant === 'link') {
    return { variant: 'ghost', tone, size: 'link' };
  }

  return { variant, tone, size };
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', tone = 'neutral', size = 'base', icon = false, ...props },
  ref
) {
  const controlVariant = resolveButtonControlVariant({ variant, tone, size });

  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      className={cx(controlVariants({ ...controlVariant, icon }), className)}
      {...props}
    />
  );
});

export { Button };
