import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { cx } from '@styles/index';
import { control } from '@styles/recipes/control';
import * as React from 'react';
import type { ControlSize, ControlTone } from '../../../styles/recipes/control';
import { toggleGroup as toggleGroupClass } from './toggle.css';

export interface ToggleProps extends Omit<TogglePrimitive.Props, 'className'> {
  /**
   * Applies caller-owned classes to the rendered toggle root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Shared four-step control size. @default 'base' */
  size?: ControlSize;
  /** Semantic status intent. @default 'neutral' */
  tone?: ControlTone;
  /** Makes the selected size square and removes inline padding. @default false */
  icon?: boolean;
}

export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { className, size = 'base', tone = 'neutral', icon = false, ...props },
  ref
) {
  return (
    <TogglePrimitive
      ref={ref}
      {...props}
      data-slot="toggle"
      data-emphasis="low"
      data-size={size}
      data-tone={tone}
      data-icon-only={icon ? '' : undefined}
      className={cx(control({ emphasis: 'low', tone, size, iconOnly: icon }), className)}
    />
  );
});

interface ToggleGroupStyle {
  size: ControlSize;
  tone: ControlTone;
}

const ToggleGroupStyleContext = React.createContext<ToggleGroupStyle>({
  size: 'xs',
  tone: 'neutral',
});

export interface ToggleGroupProps extends Omit<ToggleGroupPrimitive.Props, 'className'> {
  /** Applies caller-owned classes to the rendered group root. */
  className?: string;
  /** Default size inherited by group items. @default 'xs' */
  size?: ControlSize;
  /** Default tone inherited by group items. @default 'neutral' */
  tone?: ControlTone;
}

function ToggleGroupRoot({ className, size = 'xs', tone = 'neutral', ...props }: ToggleGroupProps) {
  return (
    <ToggleGroupStyleContext.Provider value={{ size, tone }}>
      <ToggleGroupPrimitive
        {...props}
        data-slot="toggle-group"
        data-size={size}
        data-tone={tone}
        className={cx(toggleGroupClass, className)}
      />
    </ToggleGroupStyleContext.Provider>
  );
}

export interface ToggleGroupItemProps extends Omit<TogglePrimitive.Props, 'className'> {
  /** Applies caller-owned classes to the rendered group-item root. */
  className?: string;
  /** Overrides the size inherited from ToggleGroup.Root. */
  size?: ControlSize;
  /** Overrides the tone inherited from ToggleGroup.Root. */
  tone?: ControlTone;
  /** Makes the selected size square and removes inline padding. @default false */
  icon?: boolean;
}

const ToggleGroupItem = React.forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  function ToggleGroupItem({ className, size, tone, icon = false, ...props }, ref) {
    const groupStyle = React.useContext(ToggleGroupStyleContext);
    const resolvedSize = size ?? groupStyle.size;
    const resolvedTone = tone ?? groupStyle.tone;

    return (
      <TogglePrimitive
        ref={ref}
        {...props}
        data-slot="toggle-group-item"
        data-emphasis="low"
        data-size={resolvedSize}
        data-tone={resolvedTone}
        data-icon-only={icon ? '' : undefined}
        className={cx(
          control({
            emphasis: 'low',
            tone: resolvedTone,
            size: resolvedSize,
            iconOnly: icon,
          }),
          className
        )}
      />
    );
  }
);

export const ToggleGroup = {
  Root: ToggleGroupRoot,
  Item: ToggleGroupItem,
};
