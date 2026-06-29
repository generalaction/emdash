import * as React from 'react';
import { Input, type InputProps } from '@react/primitives/input';
import { FormFieldShell, type FieldOrientation } from '../field-shell';
import { useFieldContext } from '../form-context';

export interface NumberFieldProps extends Omit<
  InputProps,
  'value' | 'onChange' | 'id' | 'name' | 'type'
> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  orientation?: FieldOrientation;
  className?: string;
}

export function NumberField({
  label,
  description,
  orientation,
  className,
  ...inputProps
}: NumberFieldProps) {
  const field = useFieldContext<number>();
  return (
    <FormFieldShell
      label={label}
      description={description}
      orientation={orientation}
      className={className}
    >
      {({ id, invalid }) => (
        <Input
          id={id}
          name={field.name}
          type="number"
          value={field.state.value ?? ''}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(Number(e.target.value))}
          aria-invalid={invalid || undefined}
          {...inputProps}
        />
      )}
    </FormFieldShell>
  );
}
