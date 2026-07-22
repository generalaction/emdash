import * as React from 'react';
import {
  Field,
  FieldContent,
  FieldControlSlot,
  FieldDescription,
  FieldLabel,
} from '../form/field/field';

export interface SettingsRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  htmlFor?: string;
  controlClassName?: string;
  className?: string;
}

/**
 * SettingsRow — label and supporting text paired with a right-aligned control.
 *
 * Use this for custom or externally controlled settings. Form-backed settings
 * can use the horizontal fields from `@emdash/ui/react/form` directly.
 */
export function SettingsRow({
  label,
  description,
  control,
  htmlFor,
  controlClassName,
  className,
}: SettingsRowProps) {
  return (
    <Field orientation="horizontal" className={className}>
      <FieldContent>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {description != null && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <FieldControlSlot className={controlClassName}>{control}</FieldControlSlot>
    </Field>
  );
}
