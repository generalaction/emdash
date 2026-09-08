'use client';

import { Input as InputPrimitive } from '@base-ui/react/input';
import type { VariantProps } from '@styles/index';
import { cx } from '@styles/index';
import * as React from 'react';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';
import { Button } from '../button';
import * as styles from './input-group.css';
import { fieldShell } from '@styles/recipes/field-shell.css';

export type InputGroupAppearance = 'standalone' | 'embedded';
export type InputGroupAddonAlign = VariantProps<typeof styles.inputGroupAddon>['align'];

interface InputGroupState {
  disabled: boolean;
  invalid: boolean;
  readOnly: boolean;
}

const InputGroupContext = React.createContext<InputGroupState>({
  disabled: false,
  invalid: false,
  readOnly: false,
});

export interface InputGroupRootProps extends React.ComponentProps<'div'> {
  /**
   * Applies caller-owned classes to the rendered group root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Visual containment for the field shell. @default 'standalone' */
  appearance?: InputGroupAppearance;
  /** Shared text-entry size inherited by the group control slot. @default 'base' */
  size?: FieldControlSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
  /** Disables the group control and button slots. @default false */
  disabled?: boolean;
  /** Makes the group text-entry slots readonly. @default false */
  readOnly?: boolean;
  /** Marks the group and text-entry slots invalid. @default false */
  invalid?: boolean;
}

/**
 * State-owning field shell for caller-composed text-entry, addon, and button
 * slots. `className` is applied to the rendered group root.
 */
function InputGroupRoot({
  className,
  appearance = 'standalone',
  size = 'base',
  tone = 'neutral',
  disabled = false,
  readOnly = false,
  invalid = false,
  ...props
}: InputGroupRootProps) {
  return (
    <InputGroupContext.Provider value={{ disabled, invalid, readOnly }}>
      <div
        {...props}
        data-slot="input-group"
        data-appearance={appearance}
        data-size={size}
        data-tone={tone}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        data-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        aria-invalid={invalid || undefined}
        role="group"
        className={cx(
          fieldShell({ interaction: 'within', containment: appearance, tone }),
          styles.inputGroup({ appearance, size }),
          className
        )}
      />
    </InputGroupContext.Provider>
  );
}

export interface InputGroupAddonProps extends React.ComponentProps<'div'> {
  /** Applies caller-owned classes to the rendered addon slot. */
  className?: string;
  /** Places the addon around the control slot. @default 'inline-start' */
  align?: InputGroupAddonAlign;
}

/** Caller-owned adornment slot. Opaque children retain their own visual ownership. */
function InputGroupAddon({ className, align = 'inline-start', ...props }: InputGroupAddonProps) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cx(styles.inputGroupAddon({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          return;
        }
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      {...props}
    />
  );
}

export interface InputGroupButtonProps extends React.ComponentProps<typeof Button> {
  /** Applies caller-owned classes to the rendered button slot. */
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

function InputGroupButton({
  className,
  type = 'button',
  disabled,
  ...props
}: InputGroupButtonProps) {
  const group = React.useContext(InputGroupContext);
  return (
    <Button
      type={type}
      size="xs"
      icon
      disabled={disabled ?? group.disabled}
      className={cx(styles.inputGroupButton, className)}
      {...props}
    />
  );
}

export interface InputGroupTextProps extends React.ComponentProps<'span'> {
  /** Applies caller-owned classes to the rendered text slot. */
  className?: string;
}

function InputGroupText({ className, ...props }: InputGroupTextProps) {
  return <span className={cx(styles.inputGroupText, className)} {...props} />;
}

export interface InputGroupInputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  /** Applies caller-owned classes to the rendered input slot. */
  className?: string;
}

function InputGroupInput({
  className,
  disabled,
  readOnly,
  onKeyDown,
  'aria-invalid': ariaInvalid,
  ...props
}: InputGroupInputProps) {
  const group = React.useContext(InputGroupContext);
  return (
    <InputPrimitive
      data-slot="input-group-control"
      disabled={disabled ?? group.disabled}
      readOnly={readOnly ?? group.readOnly}
      aria-invalid={(ariaInvalid ?? group.invalid) || undefined}
      className={cx(styles.inputGroupControl, className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === 'Escape') {
          event.currentTarget.blur();
        }
      }}
      {...props}
    />
  );
}

export interface InputGroupTextareaProps extends Omit<React.ComponentProps<'textarea'>, 'size'> {
  /** Applies caller-owned classes to the rendered textarea slot. */
  className?: string;
}

function InputGroupTextarea({
  className,
  disabled,
  readOnly,
  'aria-invalid': ariaInvalid,
  ...props
}: InputGroupTextareaProps) {
  const group = React.useContext(InputGroupContext);
  return (
    <textarea
      data-slot="input-group-control"
      disabled={disabled ?? group.disabled}
      readOnly={readOnly ?? group.readOnly}
      aria-invalid={(ariaInvalid ?? group.invalid) || undefined}
      className={cx(styles.inputGroupTextareaControl, className)}
      {...props}
    />
  );
}

export const InputGroup = {
  Root: InputGroupRoot,
  Addon: InputGroupAddon,
  Button: InputGroupButton,
  Text: InputGroupText,
  Input: InputGroupInput,
  Textarea: InputGroupTextarea,
};
