import { ComboboxPopover } from '@/react/components/combobox-popover';
import type { FieldControlSize, FieldControlTone } from '../../../../styles/recipes/field-control';
import { FormFieldShell, type FieldOrientation } from '../field-shell';
import { useFieldContext } from '../form-context';
import type { SelectOption } from './select-field';

export interface ComboboxSelectFieldProps {
  options: SelectOption[];
  label?: React.ReactNode;
  description?: React.ReactNode;
  orientation?: FieldOrientation;
  /** Applies caller-owned classes to the rendered Field root. */
  className?: string;
  /** Applies caller-owned classes to the nested combobox trigger slot. */
  controlClassName?: string;
  searchPlaceholder?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: FieldControlSize;
  tone?: FieldControlTone;
}

export function ComboboxSelectField({
  options,
  label,
  description,
  orientation,
  className,
  controlClassName,
  searchPlaceholder,
  placeholder,
  disabled,
  size = 'base',
  tone = 'neutral',
}: ComboboxSelectFieldProps) {
  const field = useFieldContext<string>();
  return (
    <FormFieldShell
      label={label}
      description={description}
      orientation={orientation}
      className={className}
    >
      {({ id, invalid }) => (
        <ComboboxPopover
          appearance="input"
          className={controlClassName}
          disabled={disabled}
          invalid={invalid}
          items={options}
          value={field.state.value}
          onValueChange={field.handleChange}
          onTriggerBlur={field.handleBlur}
          itemToKey={(o) => o.value}
          itemToLabel={(o) => String(o.label)}
          renderTrigger={(sel) => sel?.label ?? placeholder ?? 'Select…'}
          renderItem={(o) => o.label}
          searchPlaceholder={searchPlaceholder}
          size={size}
          tone={tone}
          triggerId={id}
        />
      )}
    </FormFieldShell>
  );
}
