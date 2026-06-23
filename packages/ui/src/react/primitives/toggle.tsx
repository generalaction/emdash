import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { controlVariants, type ControlVariantProps } from '@styles/recipes/control';
import * as React from 'react';
import { cx } from '@styles/utilities/cx';
import { toggleGroup as toggleGroupClass } from './toggle.css';

// ── Toggle ────────────────────────────────────────────────────────────────────

export interface ToggleProps
  extends TogglePrimitive.Props, Pick<ControlVariantProps, 'size' | 'tone'> {
  icon?: boolean;
}

/**
 * A stateful button that toggles between pressed and not-pressed.
 * base-ui sets data-pressed / aria-pressed which the controlVariants recipe
 * already maps to bg-surface-selected, so no extra color rules needed.
 */
const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { className, size = 'base', tone = 'neutral', icon = false, ...props },
  ref
) {
  return (
    <TogglePrimitive
      ref={ref}
      data-slot="toggle"
      className={cx(controlVariants({ variant: 'ghost', tone, size, icon }), className)}
      {...props}
    />
  );
});

// ── ToggleGroup ───────────────────────────────────────────────────────────────

export interface ToggleGroupProps extends ToggleGroupPrimitive.Props {
  size?: ControlVariantProps['size'];
  tone?: ControlVariantProps['tone'];
}

/**
 * A group of Toggle buttons where one or many can be active.
 * Each item inside uses the Toggle component or raw TogglePrimitive.Item.
 */
function ToggleGroup({ className, ...props }: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cx(toggleGroupClass, className)}
      {...props}
    />
  );
}

/**
 * A single item inside a ToggleGroup.
 */
const ToggleGroupItem = React.forwardRef<
  HTMLButtonElement,
  TogglePrimitive.Props & Pick<ControlVariantProps, 'size' | 'tone'> & { icon?: boolean }
>(function ToggleGroupItem(
  { className, size = 'sm', tone = 'neutral', icon = false, ...props },
  ref
) {
  return (
    <TogglePrimitive
      ref={ref}
      data-slot="toggle-group-item"
      className={cx(controlVariants({ variant: 'ghost', tone, size, icon }), className)}
      {...props}
    />
  );
});

export { Toggle, ToggleGroup, ToggleGroupItem };
