import { Field as FieldPrimitive } from '@base-ui/react/field';
import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset';
import { joinClassNames as cx } from '@styles/classnames';
import * as React from 'react';
import * as styles from './field.css';

// ── Root ──────────────────────────────────────────────────────────────────────

export type FieldOrientation = 'vertical' | 'horizontal';

export interface FieldRootProps extends Omit<FieldPrimitive.Root.Props, 'className'> {
  /**
   * Applies caller-owned classes to the rendered Field root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Semantic field layout. @default 'vertical' */
  orientation?: FieldOrientation;
}

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
function FieldRoot({ className, orientation = 'vertical', ...props }: FieldRootProps) {
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

// ── Grouping ──────────────────────────────────────────────────────────────────

export type FieldLegendVariant = 'legend' | 'label';

export interface FieldLegendProps extends Omit<FieldsetPrimitive.Legend.Props, 'className'> {
  /** Applies caller-owned classes to the rendered legend slot. */
  className?: string;
  /** Semantic typography treatment. @default 'legend' */
  variant?: FieldLegendVariant;
}

/**
 * FieldSet — a semantic `<fieldset>` grouping related fields; pair with
 * FieldLegend. Disabling the fieldset disables every field inside it.
 */
function FieldSet({ className, ...props }: FieldsetPrimitive.Root.Props) {
  return (
    <FieldsetPrimitive.Root
      data-slot="field-set"
      className={cx(styles.fieldSet, className)}
      {...props}
    />
  );
}

/**
 * FieldLegend — the heading of a FieldSet. The `label` variant drops it to
 * label-size typography for compact groups.
 */
function FieldLegend({ className, variant = 'legend', ...props }: FieldLegendProps) {
  return (
    <FieldsetPrimitive.Legend
      data-slot="field-legend"
      data-variant={variant}
      className={cx(styles.fieldLegend({ variant }), className)}
      {...props}
    />
  );
}

/**
 * FieldGroup — a plain vertical stack of Field rows with consistent spacing.
 * Use inside dialogs/forms to lay out multiple fields.
 */
function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cx(styles.fieldGroup, className)} {...props} />;
}

export const Field = {
  Root: FieldRoot,
  Content: FieldContent,
  ControlSlot: FieldControlSlot,
  Label: FieldLabel,
  Description: FieldDescription,
  Error: FieldError,
  Set: FieldSet,
  Legend: FieldLegend,
  Group: FieldGroup,
};
