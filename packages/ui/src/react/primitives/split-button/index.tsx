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
import { cx } from '@styles/index';
import { control } from '@styles/recipes/control';
import { ChevronDownIcon } from 'lucide-react';
import type { ControlTone } from '../../../styles/recipes/control';
import { Button, resolveButtonControl, type ButtonProps, type ButtonVariant } from '../button';
import { Icon, IconSlot } from '../icon';
import * as styles from './split-button.css';

export type SplitButtonOptionTone = 'neutral' | 'accept' | 'reject';

export type SplitButtonOption = {
  id: string;
  label: string;
  /** Secondary muted text rendered under the label in the option menu. */
  description?: string;
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
   * Called on primary-face click (current selection) and — unless
   * `commitOnSelect` is false — on menu item click.
   */
  onAction: (id: string) => void;
  /**
   * Whether picking an option from the menu fires `onAction` immediately.
   * Set to false for select-then-commit flows (e.g. picking a merge strategy)
   * where the menu only changes the pending selection and the primary face
   * commits it. @default true
   */
  commitOnSelect?: boolean;
  disabled?: boolean;
  /** Disables both segments and swaps the face label for `loadingLabel`. */
  loading?: boolean;
  loadingLabel?: string;
  /** Decorative leading content rendered in an authoritative-size icon slot. */
  icon?: React.ReactNode;
  size?: ButtonProps['size'];
  variant?: ButtonVariant;
  tone?: ControlTone;
  /** Stretch to the container width; the face grows and truncates. */
  fullWidth?: boolean;
  /**
   * Applies caller-owned classes to the rendered SplitButton group root. Use
   * `sx()` for finite static layout overrides.
   */
  className?: string;
  /**
   * Extra class for the portaled option menu. The menu mounts under <body>,
   * so hosts that scope theming to a subtree (e.g. the ChatComposer contract
   * bridge) must carry the scope class onto it.
   */
  menuClassName?: string;
}

// ── SplitButton ───────────────────────────────────────────────────────────────

export function SplitButton({
  options,
  selectedId,
  onSelectedChange,
  onAction,
  commitOnSelect = true,
  disabled = false,
  loading = false,
  loadingLabel,
  icon,
  size = 'xs',
  variant = 'primary',
  tone = 'neutral',
  fullWidth = false,
  className,
  menuClassName,
}: SplitButtonProps) {
  const selectedOption =
    (selectedId ? options.find((o) => o.id === selectedId) : undefined) ?? options[0];
  const controlOptions = resolveButtonControl({ variant, tone, size });
  const hasFilledSegment =
    variant === 'primary' || variant === 'destructive' || variant === 'secondary';
  const isDisabled = disabled || loading;
  const faceLabel = loading ? (loadingLabel ?? selectedOption?.label) : selectedOption?.label;

  const handleMenuSelect = (option: SplitButtonOption) => {
    onSelectedChange?.(option.id);
    if (commitOnSelect) onAction(option.id);
  };

  return (
    <div
      data-slot="split-button"
      className={cx(styles.splitButtonRoot, fullWidth && styles.splitButtonRootFull, className)}
    >
      {/* Primary face — fires the currently selected option */}
      <Button
        variant={variant}
        size={size}
        tone={tone}
        disabled={isDisabled}
        className={cx(styles.splitButtonFace, fullWidth && styles.splitButtonFaceFull)}
        title={selectedOption?.label}
        onClick={() => {
          if (selectedOption) onAction(selectedOption.id);
        }}
      >
        {icon && <IconSlot>{icon}</IconSlot>}
        <span className={styles.splitButtonLabel}>{faceLabel ?? ''}</span>
      </Button>

      {/* Chevron trigger — opens the option menu */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={isDisabled}
          aria-label="More options"
          data-slot="split-button-trigger"
          data-emphasis={controlOptions.emphasis}
          data-size={controlOptions.size}
          data-tone={controlOptions.tone}
          data-icon-only=""
          className={cx(
            control({ ...controlOptions, iconOnly: true }),
            styles.splitButtonChevronFace,
            hasFilledSegment && styles.chevronBorderLeft
          )}
        >
          <Icon source={ChevronDownIcon} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className={menuClassName} align="end" sideOffset={4}>
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.id}
              title={option.label}
              className={option.description ? styles.splitButtonMenuItemStacked : undefined}
              onClick={() => handleMenuSelect(option)}
            >
              <span className={styles.splitButtonMenuLabel}>{option.label}</span>
              {option.description && (
                <span className={styles.splitButtonMenuDescription}>{option.description}</span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}
