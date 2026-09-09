import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cx } from '@styles/index';
import { control } from '@styles/recipes/control';
import * as React from 'react';
import type { ControlOptions, ControlSize, ControlTone } from '../../../styles/recipes/control';
import * as buttonStyles from './button.css';

export type ButtonVariant = 'ghost' | 'primary' | 'secondary' | 'destructive' | 'link';

export type ButtonProps = Omit<ButtonPrimitive.Props, 'className'> & {
  /**
   * Applies caller-owned classes to the rendered button root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Semantic button presentation. @default 'ghost' */
  variant?: ButtonVariant;
  /** Shared four-step control size. @default 'base' */
  size?: ControlSize;
  /** Semantic status intent. @default 'neutral' */
  tone?: ControlTone;
  /** Square aspect ratio; collapses padding. Combines with size. */
  icon?: boolean;
  /** Trailing keyboard shortcut; reduces right padding so the Kbd aligns. */
  kbd?: React.ReactNode;
};

export function resolveButtonControl({
  variant,
  tone,
  size,
}: {
  variant: ButtonVariant;
  tone: ControlTone;
  size: ControlSize;
}): ControlOptions {
  if (variant === 'destructive') {
    return { emphasis: 'high', tone: 'destructive', size };
  }

  if (variant === 'link') {
    return { emphasis: 'minimal', tone, size };
  }

  const emphasis = {
    ghost: 'low',
    secondary: 'medium',
    primary: 'high',
  } as const;

  return { emphasis: emphasis[variant], tone, size };
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'ghost',
    tone = 'neutral',
    size = 'base',
    icon = false,
    kbd,
    children,
    ...props
  },
  ref
) {
  const controlOptions = resolveButtonControl({ variant, tone, size });

  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      {...props}
      data-emphasis={controlOptions.emphasis}
      data-size={controlOptions.size}
      data-tone={controlOptions.tone}
      data-presentation={variant === 'link' ? 'link' : undefined}
      data-icon-only={icon ? '' : undefined}
      data-kbd={kbd ? '' : undefined}
      className={cx(control({ ...controlOptions, iconOnly: icon }), buttonStyles.root, className)}
    >
      {children}
      {kbd}
    </ButtonPrimitive>
  );
});

/**
 * Shared interactive control with semantic presentation, size, and tone.
 *
 * `className` is applied to the button root. Use `sx()` there for caller-owned
 * layout; interaction and visual state remain owned by the control Recipe.
 *
 * @example
 * ```tsx
 * <Button variant="primary" className={sx({ width: 'full' })}>
 *   Continue
 * </Button>
 * ```
 */
export { Button };
