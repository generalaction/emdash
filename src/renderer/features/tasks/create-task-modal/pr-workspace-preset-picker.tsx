import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Switch } from '@renderer/lib/ui/switch';
import type { WorkspacePresetId } from '@shared/core/workspaces/workspace-presets';
import { BranchNameField } from './branch-name-field';
import type { BranchNameState } from './use-branch-name';
import type { BranchSelectionState } from './use-branch-selection';

interface PrWorkspacePresetPickerProps {
  presetId: WorkspacePresetId;
  onPresetChange: (id: WorkspacePresetId) => void;
  branchSelection: BranchSelectionState;
  branchNameState: BranchNameState;
  disabled?: boolean;
}

const PR_PRESETS: { value: 'checkout-pr' | 'pr-new-branch'; label: string }[] = [
  { value: 'checkout-pr', label: 'Checkout PR branch for review' },
  { value: 'pr-new-branch', label: 'Create task branch on top of PR' },
];

/**
 * Sub-picker shown in the new-worktree mode when a PR is linked.
 * Replaces the old CheckoutModeGroup.
 */
export function PrWorkspacePresetPicker({
  presetId,
  onPresetChange,
  branchSelection,
  branchNameState,
  disabled,
}: PrWorkspacePresetPickerProps) {
  const activePrPreset =
    presetId === 'checkout-pr' || presetId === 'pr-new-branch' ? presetId : 'checkout-pr';
  const showBranchConfig = activePrPreset === 'pr-new-branch';

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={activePrPreset}
        onValueChange={(v) => onPresetChange(v as 'checkout-pr' | 'pr-new-branch')}
        className="flex flex-col gap-1.5"
      >
        {PR_PRESETS.map((preset) => (
          <Label key={preset.value} className="flex cursor-pointer items-center gap-3 font-normal">
            <RadioGroupItem value={preset.value} disabled={disabled} />
            {preset.label}
          </Label>
        ))}
      </RadioGroup>

      {showBranchConfig && (
        <div className="flex flex-col gap-2 pl-6">
          <BranchNameField state={branchNameState} />
          <Field orientation="horizontal">
            <Switch
              checked={branchSelection.pushBranch}
              onCheckedChange={branchSelection.setPushBranch}
              disabled={disabled}
            />
            <FieldLabel>Push branch to remote</FieldLabel>
          </Field>
        </div>
      )}
    </div>
  );
}
