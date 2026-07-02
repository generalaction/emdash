import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { controlVariants, type ControlVariantProps } from '@styles/recipes/control';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { toggleGroup as toggleGroupClass } from './toggle.css';

// ── Toggle ────────────────────────────────────────────────────────────────────

export interface ToggleProps
  extends TogglePrimitive.Props, Pick<ControlVariantProps, 'size' | 'tone'> {
  icon?: boolean;
}

export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
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

function ToggleGroupRoot({ className, ...props }: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cx(toggleGroupClass, className)}
      {...props}
    />
  );
}

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

export const ToggleGroup = {
  Root: ToggleGroupRoot,
  Item: ToggleGroupItem,
};
