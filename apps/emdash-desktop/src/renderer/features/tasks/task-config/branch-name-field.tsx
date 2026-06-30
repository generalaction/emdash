import type { BranchNameState } from '@renderer/features/tasks/create-task-modal/use-branch-name';
import { EditableNameField } from '@renderer/lib/ui/editable-name-field';
import { FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { useTaskConfig } from './task-config-context';

interface BranchNameFieldProps {
  state: Pick<
    BranchNameState,
    | 'branchName'
    | 'customBranchNameSeed'
    | 'setBranchName'
    | 'resetBranchName'
    | 'isUserModified'
    | 'branchAlreadyExists'
  >;
  pushBranch?: boolean;
  onPushBranchChange?: (value: boolean) => void;
}

export function BranchNameField({ state, pushBranch, onPushBranchChange }: BranchNameFieldProps) {
  const { autoBranchName, customBranchNameControl } = useTaskConfig();
  const {
    branchName,
    customBranchNameSeed,
    setBranchName,
    resetBranchName,
    isUserModified,
    branchAlreadyExists,
  } = state;
  const showPush = pushBranch !== undefined && onPushBranchChange !== undefined;

  function handleCustomBranchNameChange(checked: boolean) {
    if (checked) {
      setBranchName(customBranchNameSeed);
    } else {
      resetBranchName();
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-border px-2.5 py-2">
      <span className="flex items-center gap-1.5 text-xs text-foreground-passive">Branch name</span>
      {autoBranchName ? (
        <div className="flex items-center gap-2 py-1">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground-muted italic">
            Branch name will be auto-generated
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <EditableNameField
              value={branchName}
              onChange={(value) => setBranchName(value)}
              placeholder="branch-name"
              className="min-w-0 flex-1 text-sm!"
            />
          </div>
          {branchAlreadyExists && (
            <p className="text-muted-foreground mt-1 text-xs">
              This branch already exists — the task will check it out instead of creating a new one.
            </p>
          )}
        </>
      )}
      {showPush && (
        <div className="mt-1 flex items-center gap-1.5">
          <Switch size="sm" checked={pushBranch} onCheckedChange={onPushBranchChange} />
          <FieldLabel>Push branch to remote</FieldLabel>
        </div>
      )}
      {customBranchNameControl && (
        <div className="mt-1 flex items-center gap-1.5">
          <Switch
            size="sm"
            checked={isUserModified}
            onCheckedChange={handleCustomBranchNameChange}
          />
          <FieldLabel>Custom branch name</FieldLabel>
        </div>
      )}
    </div>
  );
}
