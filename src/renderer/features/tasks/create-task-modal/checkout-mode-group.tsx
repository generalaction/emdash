import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
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
        <Label className="flex items-center gap-3 cursor-pointer font-normal">
          <RadioGroupItem value="checkout" disabled={disabled} />
          Checkout branch for review
        </Label>
        <Label className="flex items-center gap-3 cursor-pointer font-normal">
          <RadioGroupItem value="new-branch" disabled={disabled} />
          Create task branch and worktree
        </Label>
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
