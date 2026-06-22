/**
 * Badge — seed SolidJS component demonstrating shared VE theme reuse.
 *
 * Consumes the shared VE recipe from theme/core/ to prove cross-framework token
 * reuse: the same design-system colors defined once in theme/core/ render
 * identically in React (via @emdash/ui/react) and Solid (via @emdash/ui/solid).
 */
import type { JSX } from 'solid-js';
import { mergeProps, splitProps } from 'solid-js';
import { badgeVariants } from './badge.css';

export type BadgeVariant = 'default' | 'success' | 'error';

export interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children?: JSX.Element;
}

export function Badge(rawProps: BadgeProps) {
  const props = mergeProps({ variant: 'default' as BadgeVariant }, rawProps);
  const [local, rest] = splitProps(props, ['variant', 'class', 'children']);
  return (
    <span
      class={[badgeVariants({ variant: local.variant }), local.class].filter(Boolean).join(' ')}
      {...rest}
    >
      {local.children}
    </span>
  );
}
