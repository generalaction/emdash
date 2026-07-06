/**
 * SplitButton — a two-part button composed of a primary action face and a
 * chevron that opens a dropdown listing all available options.
 *
 * Left face: fires onAction with the currently-selected option id.
 * Right chevron: opens a DropdownMenu so the user can change the selection
 * before committing (selecting an item fires onAction immediately).
 *
 * Built on Button + DropdownMenu so Base UI handles portaling, outside-click,
 * Escape, and positioning with no manual listeners required.
 */

import { DropdownMenu } from '@react/primitives/dropdown-menu';
import { controlVariants, type ControlVariantProps } from '@styles/recipes/control';
import { cx } from '@styles/utilities/cx';
import { ChevronDownIcon } from 'lucide-react';
import { Button, type ButtonProps } from '../button';
import * as styles from './split-button.css';

export type SplitButtonOptionTone = 'neutral' | 'accept' | 'reject';

export type SplitButtonOption = {
  id: string;
  label: string;
  /**
   * Visual tone hint rendered as a small color dot before the label.
   * Defaults to 'neutral' when omitted.
   */
  tone?: SplitButtonOptionTone;
};

export interface SplitButtonProps {
  options: SplitButtonOption[];
  /**
   * Id of the currently selected option shown on the primary face.
   * Falls back to the first option when omitted or not found.
   */
  selectedId?: string;
  onSelectedChange?: (id: string) => void;
  /**
   * Fires with the id of the chosen option.
   * Called on primary-face click (current selection) and on menu item click.
   */
  onAction: (id: string) => void;
  disabled?: boolean;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  tone?: ControlVariantProps['tone'];
  className?: string;
}

// ── SplitButton ───────────────────────────────────────────────────────────────

export function SplitButton({
  options,
  selectedId,
  onSelectedChange,
  onAction,
  disabled = false,
  size = 'sm',
  variant = 'primary',
  tone = 'neutral',
  className,
}: SplitButtonProps) {
  const selectedOption =
    (selectedId ? options.find((o) => o.id === selectedId) : undefined) ?? options[0];

  const handleMenuSelect = (option: SplitButtonOption) => {
    onSelectedChange?.(option.id);
    onAction(option.id);
  };

  return (
    <div className={cx(styles.splitButtonRoot, className)}>
      {/* Primary face — fires the currently selected option */}
      <Button
        variant={variant}
        size={size}
        tone={tone}
        disabled={disabled}
        className={styles.splitButtonFace}
        onClick={() => {
          if (selectedOption) onAction(selectedOption.id);
        }}
      >
        {selectedOption?.label ?? ''}
      </Button>

      {/* Chevron trigger — opens the option menu */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={disabled}
          aria-label="More options"
          className={cx(
            controlVariants({ variant, size, tone, icon: true }),
            styles.splitButtonChevronFace,
            variant === 'primary' && styles.chevronBorderLeft
          )}
        >
          <ChevronDownIcon />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" sideOffset={4}>
          {options.map((option) => (
            <DropdownMenu.Item key={option.id} onClick={() => handleMenuSelect(option)}>
              {option.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}
