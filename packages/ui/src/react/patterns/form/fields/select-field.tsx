import { Select } from '@react/primitives/select';
import * as React from 'react';
import type { FieldControlSize, FieldControlTone } from '../../../../styles/recipes/field-control';
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
  /** Applies caller-owned classes to the rendered Field root. */
  className?: string;
  /** Applies caller-owned classes to the nested Select trigger slot. */
  controlClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: FieldControlSize;
  tone?: FieldControlTone;
}

export function SelectField({
  options,
  label,
  description,
  orientation,
  className,
  controlClassName,
  placeholder,
  disabled,
  size = 'base',
  tone = 'neutral',
}: SelectFieldProps) {
  const field = useFieldContext<string>();
  return (
    <FormFieldShell
      label={label}
      description={description}
      orientation={orientation}
      className={className}
    >
      {({ id, invalid }) => (
        <Select.Root
          value={field.state.value}
          onValueChange={(value) => {
            if (value !== null) field.handleChange(value);
          }}
          disabled={disabled}
        >
          <Select.Trigger
            id={id}
            onBlur={field.handleBlur}
            appearance="input"
            aria-invalid={invalid || undefined}
            className={controlClassName}
            size={size}
            tone={tone}
          >
            <Select.Value placeholder={placeholder} />
          </Select.Trigger>
          <Select.Content>
            {options.map((opt) => (
              <Select.Item key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}
    </FormFieldShell>
  );
}
