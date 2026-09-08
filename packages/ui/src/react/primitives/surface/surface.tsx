/**
 * Renders a region that establishes inherited Surface context for itself and
 * descendants. At least one of `level`, `role="paper"`, `tone`, or
 * `emphasis={true}` is required.
 *
 * `className` is applied to the rendered root so callers can own layout through
 * `sx()`. `role="paper"` selects the Surface Role; other valid ARIA roles are
 * forwarded when another visual axis is present.
 *
 * @example
 * ```tsx
 * <Surface level="base" className={sx({ p: tokens.space.step4 })}>
 *   <Surface emphasis>Context-relative content</Surface>
 * </Surface>
 * ```
 */

import type { SurfaceLevelName, SurfaceRoleName, SurfaceToneName } from '@emdash/theme';
import { cx } from '@styles/index';
import { surface, type SurfaceOptions } from '@styles/recipes/surface';
import React from 'react';

interface SurfaceAxes {
  /** Absolute position in the canonical Surface elevation ladder. */
  level?: SurfaceLevelName;
  /** Neutral-status intent applied within the selected or inherited context. */
  tone?: SurfaceToneName;
  /** Selects the surrounding Surface's context-relative emphasis. */
  emphasis?: boolean;
  /** Surface Role (`paper`) or, with another visual axis, a normal ARIA role. */
  role?: SurfaceRoleName | React.AriaRole;
}

type RequiredSurfaceAxis =
  | { level: SurfaceLevelName }
  | { role: SurfaceRoleName }
  | { tone: SurfaceToneName }
  | { emphasis: true };

export type SurfaceProps = Omit<React.HTMLAttributes<HTMLElement>, 'role'> &
  SurfaceAxes &
  RequiredSurfaceAxis & {
    /** Element rendered as the Surface root. Defaults to `div`. */
    as?: React.ElementType;
  };

export function Surface({
  level,
  emphasis,
  tone,
  role,
  as: As = 'div',
  className,
  children,
  ...props
}: SurfaceProps) {
  const surfaceRole = role === 'paper' ? role : undefined;
  const ariaRole = surfaceRole == null ? role : undefined;
  const options = {
    level,
    role: surfaceRole,
    tone,
    emphasis,
  } as SurfaceOptions;

  return (
    <As role={ariaRole} className={cx(surface(options), className)} {...props}>
      {children}
    </As>
  );
}
