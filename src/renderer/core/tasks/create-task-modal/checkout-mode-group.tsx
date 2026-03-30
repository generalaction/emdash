import { Field, FieldLabel } from '@renderer/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group';
import { CheckoutMode } from './use-from-pull-request-mode';

interface CheckoutModeGroupProps {
  value: CheckoutMode;
  onValueChange: (value: CheckoutMode) => void;
}

export function CheckoutModeGroup({ value, onValueChange }: CheckoutModeGroupProps) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onValueChange(v as CheckoutMode)}>
      <Field orientation="horizontal">
        <RadioGroupItem value="checkout" />
        <FieldLabel>Checkout branch for review</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <RadioGroupItem value="new-branch" />
        <FieldLabel>Create task branch</FieldLabel>
      </Field>
    </RadioGroup>
  );
}
