import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Switch } from '@renderer/lib/ui/switch';
import { type CheckoutMode } from './use-from-pull-request-mode';

interface CheckoutModeGroupProps {
  value: CheckoutMode;
  onValueChange: (value: CheckoutMode) => void;
  pushBranch: boolean;
  onPushBranchChange: (value: boolean) => void;
  disabled?: boolean;
}

export function CheckoutModeGroup({
  value,
  onValueChange,
  pushBranch,
  onPushBranchChange,
  disabled,
}: CheckoutModeGroupProps) {
  const createBranchAndWorktree = value === 'new-branch';

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup value={value} onValueChange={(v) => onValueChange(v as CheckoutMode)}>
        <Field orientation="horizontal">
          <RadioGroupItem value="checkout" disabled={disabled} />
          <FieldLabel>Checkout branch for review</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem value="new-branch" disabled={disabled} />
          <FieldLabel>Create task branch and worktree</FieldLabel>
        </Field>
      </RadioGroup>
      {createBranchAndWorktree && (
        <Field orientation="horizontal">
          <Switch checked={pushBranch} onCheckedChange={onPushBranchChange} disabled={disabled} />
          <FieldLabel>Push branch to remote</FieldLabel>
        </Field>
      )}
    </div>
  );
}
