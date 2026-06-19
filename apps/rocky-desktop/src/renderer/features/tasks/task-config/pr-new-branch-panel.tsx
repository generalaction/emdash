import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { BranchNameField } from './branch-name-field';
import type { WorkspacePanelProps } from './new-worktree-panel';
import { SetupStepPreview } from './setup-step-preview';

export function PrNewBranchPanel({ workspaceConfig }: WorkspacePanelProps) {
  const { branchSelection, branchNameState, setupSteps } = workspaceConfig;

  return (
    <div className="flex flex-col gap-3">
      <BranchNameField state={branchNameState} />
      <Field orientation="horizontal">
        <Switch
          checked={branchSelection.pushBranch}
          onCheckedChange={branchSelection.setPushBranch}
        />
        <FieldLabel>Push branch to remote</FieldLabel>
      </Field>
      <SetupStepPreview steps={setupSteps} />
    </div>
  );
}
