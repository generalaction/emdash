import { Field as FieldPrimitive } from '@base-ui/react/field';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import * as styles from './field.css';
import type { FieldVariants } from './field.css';

// ── Root ──────────────────────────────────────────────────────────────────────

/**
 * Field — wraps a form control with accessible label/description/error wiring.
 * base-ui Field automatically connects the label via htmlFor, and wires
 * aria-describedby / aria-invalid for the nested control.
 *
 * The optional `orientation` prop switches the layout between:
 *  - `vertical` (default): label/description above the control.
 *  - `horizontal`: label/description on the left, control pinned to the right —
 *    used for settings-style rows.
 */
function Field({
  className,
  orientation = 'vertical',
  ...props
}: FieldPrimitive.Root.Props & FieldVariants) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      data-orientation={orientation}
      className={cx(styles.field({ orientation }), className)}
      {...props}
    />
  );
}

// ── Content ───────────────────────────────────────────────────────────────────

/**
 * FieldContent — groups label and description together in a flex column.
 * Use inside a `horizontal` Field so the text block stretches left and the
 * control sits at the right.
 */
function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="field-content" className={cx(styles.fieldContent, className)} {...props} />
  );
}

// ── Control slot ──────────────────────────────────────────────────────────────

/**
 * FieldControlSlot — constrains the right-side control in a horizontal field.
 * Defaults to maxWidth 12rem so inputs/selects don't grow to fill the full row.
 * Override width with className when a field needs a different cap.
 */
function FieldControlSlot({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-control-slot"
      className={cx(styles.fieldControlSlot, className)}
      {...props}
    />
  );
}

// ── Label ─────────────────────────────────────────────────────────────────────

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cx(styles.fieldLabel, className)}
      {...props}
    />
  );
}

// ── Description ───────────────────────────────────────────────────────────────

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cx(styles.fieldDescription, className)}
      {...props}
    />
  );
}

// ── Error ─────────────────────────────────────────────────────────────────────

/**
 * FieldError — only visible when the field is invalid (base-ui hides it otherwise).
 */
function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      className={cx(styles.fieldError, className)}
      {...props}
    />
  );
}

export { Field, FieldContent, FieldControlSlot, FieldDescription, FieldError, FieldLabel };
export type { FieldVariants };
