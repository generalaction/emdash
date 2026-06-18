import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { controlVariants, type ControlVariantProps } from '../recipes/control';

export interface TriggerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Pick<ControlVariantProps, 'size' | 'tone'> {
  /**
   * Show a trailing chevron icon (for selects, comboboxes, dropdowns).
   * @default true
   */
  showChevron?: boolean;
}

/**
 * TriggerButton — a ghost control that opens an overlay and reads as "active"
 * while the overlay is open.
 *
 * Used as the trigger face for Select, Combobox, DropdownMenu, and Popover.
 * When wired via base-ui's `render` prop, the primitive sets `aria-expanded`
 * and/or `data-popup-open` automatically, which the controlVariants recipe
 * maps to bg-surface-selected (active state) with no extra rules.
 *
 * Example:
 *   <SelectPrimitive.Trigger render={<TriggerButton showChevron />}>
 *     {value}
 *   </SelectPrimitive.Trigger>
 */
const TriggerButton = React.forwardRef<HTMLButtonElement, TriggerButtonProps>(
  function TriggerButton(
    { className, size = 'base', tone = 'neutral', showChevron = true, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        data-slot="trigger-button"
        className={cn(
          controlVariants({ variant: 'ghost', tone, size }),
          'w-fit justify-between gap-1.5',
          'data-placeholder:text-foreground-passive',
          '[&>[data-slot=trigger-value]]:line-clamp-1 [&>[data-slot=trigger-value]]:flex [&>[data-slot=trigger-value]]:items-center [&>[data-slot=trigger-value]]:gap-1.5',
          className,
        )}
        {...props}
      >
        {children}
        {showChevron && (
          <ChevronDownIcon
            className="pointer-events-none shrink-0 text-foreground-passive transition-transform duration-150 aria-expanded:rotate-180"
            aria-hidden
          />
        )}
      </button>
    );
  },
);

export { TriggerButton };
