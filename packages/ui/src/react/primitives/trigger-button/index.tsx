import { cx } from '@styles/index';
import { control } from '@styles/recipes/control';
import { fieldControl } from '@styles/recipes/field-control';
import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';
import type { ControlSize, ControlTone } from '../../../styles/recipes/control';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';
import { Icon } from '../icon';
import {
  triggerButtonChevron,
  triggerButtonExtra,
  triggerButtonInputExtra,
  triggerButtonValue,
} from './trigger-button.css';

interface TriggerButtonBaseProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  /**
   * Applies caller-owned classes to the rendered button root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /**
   * Show a trailing chevron icon (for selects, comboboxes, dropdowns).
   * @default true
   */
  showChevron?: boolean;
}

export type TriggerButtonProps = TriggerButtonBaseProps &
  (
    | {
        /** Uses the shared interactive-control contract. @default 'control' */
        appearance?: 'control';
        /** Shared four-step control size. @default 'base' */
        size?: ControlSize;
        /** Semantic status intent. @default 'neutral' */
        tone?: ControlTone;
      }
    | {
        /** Uses the shared field-control contract for form-oriented triggers. */
        appearance: 'input';
        /** Shared text-entry size. @default 'base' */
        size?: FieldControlSize;
        /** Semantic field status intent. @default 'neutral' */
        tone?: FieldControlTone;
      }
  );

/**
 * TriggerButton — a ghost control that opens an overlay and reads as "active"
 * while the overlay is open.
 *
 * Used as the trigger face for Select, Combobox, DropdownMenu, and Popover.
 * When wired via base-ui's `render` prop, the primitive sets `aria-expanded`
 * and/or `data-popup-open` automatically, which the public control Recipe
 * maps to bg-surface-selected (active state) with no extra rules.
 *
 * Pass `appearance="input"` in form contexts to use `fieldControl()`. In both
 * appearances, `className` is applied to the rendered button root.
 */
const TriggerButton = React.forwardRef<HTMLButtonElement, TriggerButtonProps>(
  function TriggerButton(
    {
      className,
      size = 'base',
      tone = 'neutral',
      showChevron = true,
      appearance = 'control',
      children,
      ...props
    },
    ref
  ) {
    const buttonClass =
      appearance === 'input'
        ? cx(
            fieldControl({
              size: size as FieldControlSize,
              tone: tone as FieldControlTone,
            }),
            triggerButtonInputExtra,
            className
          )
        : cx(control({ emphasis: 'low', tone, size }), triggerButtonExtra, className);

    return (
      <button
        ref={ref}
        type="button"
        data-slot="trigger-button"
        {...props}
        data-appearance={appearance}
        data-emphasis={appearance === 'control' ? 'low' : undefined}
        data-size={size}
        data-tone={tone}
        className={buttonClass}
      >
        <span data-slot="trigger-button-value" className={triggerButtonValue}>
          {children}
        </span>
        {showChevron && (
          <Icon
            source={ChevronDownIcon}
            size="sm"
            strokeWidth={1}
            className={triggerButtonChevron}
          />
        )}
      </button>
    );
  }
);

export { TriggerButton };
