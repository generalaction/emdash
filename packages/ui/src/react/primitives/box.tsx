/**
 * Box — polymorphic layout primitive.
 *
 * Accepts all Sprinkles props from `sx()` directly as props, plus a
 * `className` escape hatch for recipe/utility class names. Renders as `div`
 * by default but any HTML element tag can be passed via the `as` prop.
 *
 * Usage:
 *   <Box display="flex" alignItems="center" gap="2" padding="3">…</Box>
 *   <Box as="section" background="surface" borderRadius="md">…</Box>
 *   <Box className={cx(card(), myStyle)}>…</Box>
 *
 * Sprinkles props are applied last so they override any recipe/utility class
 * at the same `@layer utilities` level — deterministic without tailwind-merge.
 */

import React from 'react';
import { sx } from '@styles/utilities/sprinkles.css';
import type { Sprinkles } from '@styles/utilities/sprinkles.css';
import { cx } from '@styles/utilities/cx';

export type BoxProps = React.HTMLAttributes<HTMLElement> &
  Sprinkles & {
    as?: keyof React.JSX.IntrinsicElements;
    ref?: React.Ref<HTMLElement>;
  };

// Build a set of all Sprinkles property names for fast splitting.
const sprinklesPropertySet = new Set(Object.keys(sx.properties));

/**
 * Split props into `[sprinklesProps, rest]` so Sprinkles props are not
 * forwarded to the DOM element.
 */
function splitProps(props: Record<string, unknown>): [Sprinkles, Record<string, unknown>] {
  const sprinkles: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (sprinklesPropertySet.has(key)) {
      sprinkles[key] = props[key];
    } else {
      rest[key] = props[key];
    }
  }
  return [sprinkles as Sprinkles, rest];
}

export const Box = React.forwardRef<HTMLElement, BoxProps>(function Box(
  { as: Tag = 'div', className, ...rest },
  ref
) {
  const [sprinklesProps, elementProps] = splitProps(rest as Record<string, unknown>);
  const sxClass = Object.keys(sprinklesProps).length > 0 ? sx(sprinklesProps) : undefined;
  const Component = Tag as React.ElementType;
  return <Component ref={ref} className={cx(className, sxClass)} {...elementProps} />;
});
