import * as React from 'react';
import {
  Field,
  FieldContent,
  FieldControlSlot,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '../primitives/field';
import { useFieldContext } from './form-context';
import type { FieldVariants } from '../primitives/field.css';

export type FieldOrientation = NonNullable<FieldVariants['orientation']>;

export interface FormFieldShellProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  orientation?: FieldOrientation;
  className?: string;
  children: (wiring: { id: string; invalid: boolean }) => React.ReactNode;
}

/**
 * FormFieldShell — shared layout wrapper used by all typed form field components.
 *
 * Reads field state from `useFieldContext()`, computes the invalid flag, and
 * renders the accessible `Field` primitive with label, description, error, and
 * the control provided via the render-prop `children`.
 *
 * In `vertical` mode (default): label/description stack above the control.
 * In `horizontal` mode: label/description occupy the left side and the control
 * sits on the right — use this for settings-style rows.
 */
export function FormFieldShell({
  label,
  description,
  orientation = 'vertical',
  className,
  children,
}: FormFieldShellProps) {
  const field = useFieldContext();
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const id = field.name;

  const errors = invalid
    ? field.state.meta.errors
        .map((e) => (typeof e === 'string' ? e : (e as { message?: string })?.message))
        .filter(Boolean)
        .join(', ')
    : null;

  const hasTextContent = label != null || description != null;

  if (orientation === 'horizontal') {
    return (
      <Field orientation="horizontal" className={className}>
        {hasTextContent && (
          <FieldContent>
            {label != null && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
            {description != null && <FieldDescription>{description}</FieldDescription>}
          </FieldContent>
        )}
        <FieldControlSlot>{children({ id, invalid })}</FieldControlSlot>
      </Field>
    );
  }

  return (
    <Field orientation="vertical" className={className}>
      {label != null && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      {children({ id, invalid })}
      {description != null && <FieldDescription>{description}</FieldDescription>}
      {errors && <FieldError>{errors}</FieldError>}
    </Field>
  );
}
