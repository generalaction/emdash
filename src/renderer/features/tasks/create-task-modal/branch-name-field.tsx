import { EditableNameField } from '@renderer/lib/ui/editable-name-field';
import { FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import type { BranchNameState } from './use-branch-name';

interface BranchNameFieldProps {
  state: Pick<BranchNameState, 'branchName' | 'setBranchName' | 'branchAlreadyExists'>;
  pushBranch?: boolean;
  onPushBranchChange?: (value: boolean) => void;
}

export function BranchNameField({ state, pushBranch, onPushBranchChange }: BranchNameFieldProps) {
  const { branchName, setBranchName, branchAlreadyExists } = state;
  const showPush = pushBranch !== undefined && onPushBranchChange !== undefined;

  return (
    <div className="flex flex-col rounded-lg border border-border px-2.5 py-2">
      <span className="flex items-center gap-1.5 text-xs text-foreground-passive">Branch name</span>
      <EditableNameField
        value={branchName}
        onChange={(value) => setBranchName(value)}
        placeholder="branch-name"
        className="text-sm!"
      />
      {branchAlreadyExists && (
        <p className="text-muted-foreground mt-1 text-xs">
          This branch already exists — the task will check it out instead of creating a new one.
        </p>
      )}
      {showPush && (
        <div className="mt-1 flex items-center gap-1.5">
          <Switch size="sm" checked={pushBranch} onCheckedChange={onPushBranchChange} />
          <FieldLabel>Push branch to remote</FieldLabel>
        </div>
      )}
    </div>
  );
}
