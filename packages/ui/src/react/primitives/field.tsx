import { Field as FieldPrimitive } from '@base-ui/react/field';
import * as React from 'react';
import { cn } from '../lib/cn';
import * as styles from './field.css';

// ── Root ──────────────────────────────────────────────────────────────────────

/**
 * Field — wraps a form control with accessible label/description/error wiring.
 * base-ui Field automatically connects the label via htmlFor, and wires
 * aria-describedby / aria-invalid for the nested control.
 */
function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root data-slot="field" className={cn(styles.field, className)} {...props} />
  );
}

// ── Label ─────────────────────────────────────────────────────────────────────

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(styles.fieldLabel, className)}
      {...props}
    />
  );
}

// ── Description ───────────────────────────────────────────────────────────────

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn(styles.fieldDescription, className)}
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
      className={cn(styles.fieldError, className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError, FieldLabel };
