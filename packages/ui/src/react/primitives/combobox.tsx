import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { CheckIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { cx } from '@styles/utilities/cx';
import { Button } from './button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './input-group';
import * as styles from './combobox.css';

const Combobox = ComboboxPrimitive.Root;

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cx(styles.comboboxTrigger, className)}
      {...props}
    >
      {children}
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      render={<InputGroupButton />}
      className={cx(className)}
      {...props}
    >
      <XIcon style={{ pointerEvents: 'none' }} />
    </ComboboxPrimitive.Clear>
  );
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  leftAddon,
  rightAddon,
  inputRef,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean;
  showClear?: boolean;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <InputGroup className={cx(styles.inputGroupAutoWidth, styles.inputGroupNoRing, className)}>
      {leftAddon && <InputGroupAddon align="inline-start">{leftAddon}</InputGroupAddon>}
      <ComboboxPrimitive.Input
        render={<InputGroupInput ref={inputRef} disabled={disabled} />}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        {rightAddon}
        {showTrigger && (
          <InputGroupButton
            render={<ComboboxTrigger />}
            data-slot="input-group-button"
            className={styles.triggerButtonHideIfClear}
            disabled={disabled}
          />
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  );
}

function ComboboxContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  anchor,
  collisionAvoidance,
  finalFocus = false,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor' | 'collisionAvoidance'
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        className={styles.positioner}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          finalFocus={finalFocus}
          className={cx('surface-elevated', styles.comboboxContent, className)}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cx(styles.comboboxList, className)}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  showCheck = true,
  ...props
}: ComboboxPrimitive.Item.Props & { showCheck?: boolean }) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cx(styles.comboboxItem, className)}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator render={<span className={styles.comboboxItemIndicator} />}>
        {showCheck && (
          <CheckIcon style={{ pointerEvents: 'none' }} absoluteStrokeWidth strokeWidth={3} />
        )}
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group data-slot="combobox-group" className={cx(className)} {...props} />
  );
}

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cx(styles.comboboxLabel, className)}
      {...props}
    />
  );
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />;
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cx(styles.comboboxEmpty, className)}
      {...props}
    />
  );
}

function ComboboxSeparator({ className, ...props }: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cx(styles.comboboxSeparator, className)}
      {...props}
    />
  );
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> & ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cx(styles.comboboxChips, className)}
      {...props}
    />
  );
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean;
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cx(styles.comboboxChip, className)}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          render={<Button variant="ghost" size="sm" icon />}
          className={styles.comboboxChipRemove}
          data-slot="combobox-chip-remove"
        >
          <XIcon style={{ pointerEvents: 'none' }} />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxChipsInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cx(styles.comboboxChipsInput, className)}
      {...props}
    />
  );
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null);
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
};
