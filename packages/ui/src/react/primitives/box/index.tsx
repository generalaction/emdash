/**
 * Box — polymorphic layout primitive.
 *
 * Accepts Sprinkles props directly (layout, spacing, color, radius, type), an
 * optional `surface` prop that both scopes the surface cascade for descendants
 * (.surface-<value>) and paints background: var(--em-surface), plus a `className`
 * escape hatch for recipe/utility classes. Renders as `div` by default; any
 * HTML tag can be passed via `as`.
 *
 * Usage:
 *   <Box display="flex" alignItems="center" gap="2" padding="3">…</Box>
 *   <Box surface="base" borderRadius="md" padding="3">…</Box>
 *   <Box surface="elevated" background="surfaceEmphasis">…</Box>  // explicit bg wins
 *   <Box className={cx(card(), myStyle)}>…</Box>
 */

import type { SurfaceScopeName, SurfaceStatusName } from '@emdash/theme';
import { cx } from '@styles/utilities/cx';
import React from 'react';
import { sx } from '@styles/utilities/sprinkles.css';
import type { Sprinkles } from '@styles/utilities/sprinkles.css';

export type SurfaceProp = SurfaceScopeName | 'emphasis' | SurfaceStatusName;

export type BoxProps = React.HTMLAttributes<HTMLElement> &
  Sprinkles & {
    as?: keyof React.JSX.IntrinsicElements;
    ref?: React.Ref<HTMLElement>;
    /**
     * Sets the surface cascade scope (.surface-<value>) AND paints
     * background: var(--em-surface) so descendants resolve tokens correctly.
     * An explicit `background` prop overrides the paint while keeping the scope.
     */
    surface?: SurfaceProp;
  };

// Build a set of all Sprinkles property names for fast splitting.
const sprinklesPropertySet = new Set(Object.keys(sx.properties));

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
  { as: Tag = 'div', surface, className, ...rest },
  ref
) {
  const [sprinklesProps, elementProps] = splitProps(rest as Record<string, unknown>);
  // surface forces background: 'surface' unless caller overrides with an explicit background prop
  const mergedSprinkles: Sprinkles = surface
    ? { background: 'surface', ...sprinklesProps }
    : sprinklesProps;
  const sxClass = Object.keys(mergedSprinkles).length > 0 ? sx(mergedSprinkles) : undefined;
  const surfaceClass = surface ? `surface-${surface}` : undefined;
  const Component = Tag as React.ElementType;
  return <Component ref={ref} className={cx(surfaceClass, className, sxClass)} {...elementProps} />;
});
