/**
 * SelectableCard — a borderless, surface-aware button card with hover and selected states.
 *
 * Renders as a `<button>` by default. Uses the `surface` recipe so it inherits
 * elevation and status tinting from the design system. The selected state is
 * driven by `data-selected` / `aria-selected`, matching the interactive variant
 * selectors in `surface.css.ts`.
 */

import type { SurfaceStatusName } from '@emdash/theme';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { surface } from '@styles/recipes/surface.css';
import { sx } from '@styles/utilities/sprinkles.css';
import type { Sprinkles } from '@styles/utilities/sprinkles.css';

type SelectableCardLevel = 'sunken' | 'base' | 'elevated' | 'paper';

export interface SelectableCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Surface elevation level. */
  level?: SelectableCardLevel;
  /** Status tint. */
  status?: SurfaceStatusName;
  /** Enables hover + selected styling. */
  interactive?: boolean;
  /** Selected / active state. */
  selected?: boolean;
  /** Padding scale token. */
  padding?: Sprinkles['padding'];
  /** Border radius scale token. */
  borderRadius?: Sprinkles['borderRadius'];
}

export const SelectableCard = React.forwardRef<HTMLButtonElement, SelectableCardProps>(
  function SelectableCard(
    {
      level = 'base',
      status,
      interactive = true,
      selected = false,
      padding,
      borderRadius,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref
  ) {
    const isInteractive = interactive || selected;

    const sprinkles: Partial<Sprinkles> = {};
    if (padding != null) sprinkles.padding = padding;
    if (borderRadius != null) sprinkles.borderRadius = borderRadius;
    const sprinkleClass =
      Object.keys(sprinkles).length > 0 ? sx(sprinkles as Sprinkles) : undefined;

    return (
      <button
        ref={ref}
        type={type}
        data-selected={selected ? 'true' : undefined}
        aria-selected={selected}
        className={cx(
          level && `surface-${level}`,
          status && `surface-${status}`,
          surface({ level, status, interactive: isInteractive }),
          sprinkleClass,
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
