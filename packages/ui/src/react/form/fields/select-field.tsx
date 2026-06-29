import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select';
import { FormFieldShell, type FieldOrientation } from '../field-shell';
import { useFieldContext } from '../form-context';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export interface SelectFieldProps {
  options: SelectOption[];
  label?: React.ReactNode;
  description?: React.ReactNode;
  orientation?: FieldOrientation;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function SelectField({
  options,
  label,
  description,
  orientation,
  className,
  placeholder,
  disabled,
}: SelectFieldProps) {
  const field = useFieldContext<string>();
  return (
    <FormFieldShell
      label={label}
      description={description}
      orientation={orientation}
      className={className}
    >
      {({ id }) => (
        <Select
          value={field.state.value}
          onValueChange={(value) => {
            if (value !== null) field.handleChange(value);
          }}
          disabled={disabled}
        >
          <SelectTrigger id={id} onBlur={field.handleBlur} appearance="input">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormFieldShell>
  );
}
