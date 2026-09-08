import { createFormHook } from '@tanstack/react-form';
import { SubmitButton } from './components/submit-button';
import { ComboboxSelectField } from './fields/combobox-select-field';
import { NumberField } from './fields/number-field';
import { RadioGroupField } from './fields/radio-group-field';
import { SelectField } from './fields/select-field';
import { SwitchField } from './fields/switch-field';
import { TextField } from './fields/text-field';
import { TextareaField } from './fields/textarea-field';
import { fieldContext, formContext } from './form-context';

/**
 * Emdash form hook with styled field-control components and submit actions.
 *
 * Field components own focus, invalid, readonly, and disabled visuals through
 * their field-control roots. Compose form layout around `AppField`; do not
 * restyle nested input slots from the parent.
 *
 * @example
 * ```tsx
 * const form = useAppForm({ defaultValues: { name: '' }, onSubmit });
 *
 * <form.AppField name="name">
 *   {(field) => <field.TextField label="Name" />}
 * </form.AppField>;
 * ```
 */
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    NumberField,
    RadioGroupField,
    TextareaField,
    SelectField,
    ComboboxSelectField,
    SwitchField,
  },
  formComponents: {
    SubmitButton,
  },
});
