import * as React from 'react';
// Relative import: the dts emitter rewrites aliased imports to a dangling
// relative path, silently degrading the prop types.
import { Input, type InputProps } from '../../../primitives/input';
import { FormFieldShell, type FieldOrientation } from '../field-shell';
import { useFieldContext } from '../form-context';

export interface NumberFieldProps extends Omit<
  InputProps,
  'className' | 'value' | 'onChange' | 'id' | 'name' | 'type'
> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  orientation?: FieldOrientation;
  /** Applies caller-owned classes to the rendered Field root. */
  className?: string;
  /** Applies caller-owned classes to the nested Input control slot. */
  controlClassName?: string;
}

export function NumberField({
  label,
  description,
  orientation,
  className,
  controlClassName,
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
          className={controlClassName}
          {...inputProps}
        />
      )}
    </FormFieldShell>
  );
}
