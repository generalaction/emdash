import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { Button } from '@react/primitives/button';
import { Icon } from '@react/primitives/icon';
import { InputGroup, type InputGroupAppearance } from '@react/primitives/input-group';
import { ScrollContainer } from '@react/primitives/scroll-container';
import { joinClassNames as cx } from '@styles/classnames';
import { CheckIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';
import { menuItem } from '../../../styles/recipes/menu-item';
import { popupVars } from '../../../styles/recipes/popup-contract';
import * as styles from './combobox.css';
import { fieldShell } from '@styles/recipes/field-shell.css';

const ComboboxRoot = ComboboxPrimitive.Root;

interface ComboboxChipsState {
  invalid: boolean;
  readOnly: boolean;
}

const ComboboxChipsContext = React.createContext<ComboboxChipsState>({
  invalid: false,
  readOnly: false,
});

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
      render={<InputGroup.Button />}
      className={cx(className)}
      {...props}
    >
      <Icon source={XIcon} />
    </ComboboxPrimitive.Clear>
  );
}

interface ComboboxInputProps extends Omit<ComboboxPrimitive.Input.Props, 'className' | 'size'> {
  /** Applies caller-owned classes to the rendered InputGroup root. */
  className?: string;
  /** Shared text-entry size. @default 'base' */
  size?: FieldControlSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
  /** Marks the composed field shell invalid. @default false */
  invalid?: boolean;
  /** Makes the text-entry slot readonly. @default false */
  readOnly?: boolean;
  showTrigger?: boolean;
  showClear?: boolean;
  /** Caller-owned leading adornment slot. */
  leftAddon?: React.ReactNode;
  /** Caller-owned trailing adornment slot. */
  rightAddon?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Field-shell containment. @default 'embedded' */
  appearance?: InputGroupAppearance;
}

/**
 * Composed combobox text field. `className` is applied to the InputGroup root;
 * addon values are caller-owned slots.
 */
function ComboboxInput({
  className,
  children,
  disabled = false,
  invalid = false,
  readOnly = false,
  size = 'base',
  tone = 'neutral',
  showTrigger = true,
  showClear = false,
  leftAddon,
  rightAddon,
  inputRef,
  appearance = 'embedded',
  ...props
}: ComboboxInputProps) {
  return (
    <InputGroup.Root
      appearance={appearance}
      className={className}
      disabled={disabled}
      invalid={invalid}
      readOnly={readOnly}
      size={size}
      tone={tone}
    >
      {leftAddon && <InputGroup.Addon align="inline-start">{leftAddon}</InputGroup.Addon>}
      <ComboboxPrimitive.Input
        render={<InputGroup.Input ref={inputRef} disabled={disabled} />}
        {...props}
      />
      <InputGroup.Addon align="inline-end">
        {rightAddon}
        {showTrigger && (
          <InputGroup.Button
            render={<ComboboxTrigger />}
            data-slot="input-group-button"
            className={cx(styles.triggerButton, showClear && styles.triggerButtonHidden)}
            disabled={disabled}
          />
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroup.Addon>
      {children}
    </InputGroup.Root>
  );
}

/** Combobox popup. `className` is applied to the rendered listbox content root. */
function ComboboxContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  width = 'trigger',
  anchor,
  collisionAvoidance,
  finalFocus = false,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor' | 'collisionAvoidance'
  > & {
    width?: 'trigger' | 'content' | 'content-at-least-trigger';
  }) {
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
          data-width={width}
          finalFocus={finalFocus}
          className={cx(styles.comboboxContent, className)}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, children, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ScrollContainer
      maxHeight={`min(18rem, calc(${popupVars.availableHeight} - 2.25rem))`}
      padding={2}
      className={styles.comboboxListScroller}
      viewportClassName={styles.comboboxListViewport}
    >
      <ComboboxPrimitive.List
        data-slot="combobox-list"
        className={cx(styles.comboboxList, className)}
        {...props}
      >
        {children}
      </ComboboxPrimitive.List>
    </ScrollContainer>
  );
}

/** Selectable row whose interaction states are owned by `menuItem()`. */
function ComboboxItem({
  className,
  children,
  showCheck = true,
  hoverableWhenDisabled = false,
  ...props
}: ComboboxPrimitive.Item.Props & {
  showCheck?: boolean;
  /** Keep a disabled item pointer-accessible for hover-only secondary UI. */
  hoverableWhenDisabled?: boolean;
}) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      data-hoverable-when-disabled={hoverableWhenDisabled || undefined}
      className={cx(menuItem({ fullWidth: true, trailingIndicator: true }), className)}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span data-slot="combobox-item-indicator" className={styles.comboboxItemIndicator} />
        }
      >
        {showCheck && <Icon source={CheckIcon} strokeWidth={3} size="sm" />}
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

interface ComboboxChipsProps extends Omit<
  React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> & ComboboxPrimitive.Chips.Props,
  'className' | 'size'
> {
  /** Applies caller-owned classes to the rendered chips root. */
  className?: string;
  /** Shared text-entry size. @default 'base' */
  size?: FieldControlSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
  /** Marks the composed field shell invalid. @default false */
  invalid?: boolean;
  /** Makes the nested chips input readonly. @default false */
  readOnly?: boolean;
}

/**
 * State-owning multi-value field shell. `className` is applied to the rendered
 * chips root and state is inherited by `Combobox.ChipsInput`.
 */
function ComboboxChips({
  className,
  size = 'base',
  tone = 'neutral',
  invalid = false,
  readOnly = false,
  ...props
}: ComboboxChipsProps) {
  return (
    <ComboboxChipsContext.Provider value={{ invalid, readOnly }}>
      <ComboboxPrimitive.Chips
        {...props}
        data-slot="combobox-chips"
        data-size={size}
        data-tone={tone}
        data-invalid={invalid || undefined}
        data-readonly={readOnly || undefined}
        className={cx(
          fieldShell({ interaction: 'within', containment: 'standalone', tone }),
          styles.comboboxChips({ size }),
          className
        )}
      />
    </ComboboxChipsContext.Provider>
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
          render={<Button variant="ghost" size="xs" icon />}
          className={styles.comboboxChipRemove}
          data-slot="combobox-chip-remove"
        >
          <Icon source={XIcon} />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxChipsInput({
  className,
  readOnly,
  'aria-invalid': ariaInvalid,
  ...props
}: ComboboxPrimitive.Input.Props) {
  const chips = React.useContext(ComboboxChipsContext);
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      readOnly={readOnly ?? chips.readOnly}
      aria-invalid={(ariaInvalid ?? chips.invalid) || undefined}
      className={cx(styles.comboboxChipsInput, className)}
      {...props}
    />
  );
}

export function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null);
}

export const Combobox = {
  Root: ComboboxRoot,
  Value: ComboboxValue,
  Trigger: ComboboxTrigger,
  Input: ComboboxInput,
  Content: ComboboxContent,
  List: ComboboxList,
  Item: ComboboxItem,
  Group: ComboboxGroup,
  Label: ComboboxLabel,
  Collection: ComboboxCollection,
  Empty: ComboboxEmpty,
  Separator: ComboboxSeparator,
  Chips: ComboboxChips,
  Chip: ComboboxChip,
  ChipsInput: ComboboxChipsInput,
};
