import { Select as SelectPrimitive } from '@base-ui/react/select';
import { joinClassNames as cx } from '@styles/classnames';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import * as React from 'react';
import type { ControlSize, ControlTone } from '../../../styles/recipes/control';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';
import { menuItem } from '../../../styles/recipes/menu-item';
import { Icon } from '../icon';
import { TriggerButton } from '../trigger-button';
import * as styles from './select.css';

const SelectRoot = SelectPrimitive.Root;

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cx(styles.selectGroup, className)}
      {...props}
    />
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cx(styles.selectValue, className)}
      {...props}
    />
  );
}

type SelectTriggerProps = Omit<SelectPrimitive.Trigger.Props, 'className'> &
  (
    | {
        appearance?: 'control';
        size?: ControlSize;
        tone?: ControlTone;
      }
    | {
        appearance: 'input';
        size?: FieldControlSize;
        tone?: FieldControlTone;
      }
  ) & {
    /** Applies caller-owned classes to the rendered trigger root. */
    className?: string;
    /** Shows the caller-owned trailing chevron slot. @default true */
    showChevron?: boolean;
  };

/**
 * Select trigger whose `className` is applied to the rendered button root.
 * Input appearance delegates its field states to `fieldControl()`.
 */
function SelectTrigger({
  className,
  size = 'base',
  tone = 'neutral',
  showChevron = true,
  appearance = 'control',
  children,
  ...props
}: SelectTriggerProps) {
  const trigger =
    appearance === 'input' ? (
      <TriggerButton
        appearance="input"
        size={size as FieldControlSize}
        tone={tone as FieldControlTone}
        showChevron={showChevron}
        className={className}
      />
    ) : (
      <TriggerButton
        appearance="control"
        size={size as ControlSize}
        tone={tone as ControlTone}
        showChevron={showChevron}
        className={className}
      />
    );

  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" render={trigger} {...props}>
      {children}
    </SelectPrimitive.Trigger>
  );
}

/** Select popup. `className` is applied to the rendered listbox content root. */
function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  alignItemWithTrigger = false,
  width = 'content-at-least-trigger',
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger'
  > & {
    width?: 'trigger' | 'content' | 'content-at-least-trigger';
  }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className={styles.positioner}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          data-width={width}
          className={cx(styles.selectContent, className)}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cx(styles.selectLabel, className)}
      {...props}
    />
  );
}

/** Selectable row whose interaction states are owned by `menuItem()`. */
function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cx(menuItem({ fullWidth: true, trailingIndicator: true }), className)}
      {...props}
    >
      <SelectPrimitive.ItemText data-slot="select-item-text" className={styles.selectItemText}>
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span data-slot="select-item-indicator" className={styles.selectItemIndicator} />}
      >
        <Icon source={CheckIcon} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cx(styles.selectSeparator, className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cx(styles.scrollButton, className)}
      {...props}
    >
      <Icon source={ChevronUpIcon} />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cx(styles.scrollButton, className)}
      {...props}
    >
      <Icon source={ChevronDownIcon} />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export const Select = {
  Root: SelectRoot,
  Group: SelectGroup,
  Value: SelectValue,
  Trigger: SelectTrigger,
  Content: SelectContent,
  Label: SelectLabel,
  Item: SelectItem,
  Separator: SelectSeparator,
  ScrollUpButton: SelectScrollUpButton,
  ScrollDownButton: SelectScrollDownButton,
};
