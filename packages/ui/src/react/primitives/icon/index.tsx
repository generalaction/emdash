import { cx } from '@styles/index';
import * as React from 'react';
import { iconSlotAdapter } from './icon-slot.adapter.css';
import { icon, iconSlot, type IconVariants } from './icon.css';

export type IconSize = NonNullable<IconVariants['size']>;
export type StaticSvgComponent = (props: React.ComponentPropsWithRef<'svg'>) => React.ReactNode;

export interface IconProps extends Omit<
  React.ComponentPropsWithoutRef<'svg'>,
  'aria-hidden' | 'aria-label' | 'children' | 'dangerouslySetInnerHTML' | 'role'
> {
  /** Statically imported component whose rendered root is the owned SVG element. */
  source: StaticSvgComponent;
  /** Explicit size override. Omit to inherit the owning component's icon size. */
  size?: IconSize;
  /** Exposes the icon as a labeled image. Omit when the icon is decorative. */
  label?: string;
}

/**
 * Renders an owned static SVG source with the design-system icon class applied
 * directly to its root.
 *
 * Icons are decorative by default. Provide `label` only when the icon itself
 * communicates information that is not already available as adjacent text.
 * Geometry inherits the owning component's icon size and falls back to `md`.
 *
 * @example
 * ```tsx
 * <Button icon aria-label="Search">
 *   <Icon source={SearchIcon} />
 * </Button>
 * ```
 */
const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
  { source: Source, size, className, label, ...props },
  ref
) {
  return (
    <Source
      ref={ref}
      className={cx(icon({ size }), className)}
      {...props}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
    />
  );
});

export interface IconSlotProps extends Omit<
  React.ComponentPropsWithoutRef<'span'>,
  'aria-hidden' | 'children'
> {
  /** Opaque content whose rendered root may be an SVG. The child is never cloned. */
  children: React.ReactNode;
  /** Explicit size override. Omit to inherit the owning component's icon size. */
  size?: IconSize;
}

/**
 * Provides fixed icon geometry for opaque child content.
 *
 * A direct-child SVG fills the inherited or explicitly named size through the
 * shared rooted Adapter; inherited geometry falls back to `md`.
 * Slots are decorative because the owning control or adjacent text carries
 * their meaning. Nested markup remains untouched and is hidden as a subtree.
 *
 * @example
 * ```tsx
 * <IconSlot size="sm">{opaqueCallerIcon}</IconSlot>
 * ```
 */
const IconSlot = React.forwardRef<HTMLSpanElement, IconSlotProps>(function IconSlot(
  { children, size, className, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cx(iconSlotAdapter, iconSlot({ size }), className)}
      {...props}
      aria-hidden
      data-slot="icon-slot"
    >
      {children}
    </span>
  );
});

export { Icon, IconSlot };
