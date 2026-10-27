import { Input, Label, Switch } from '@emdash/ui/react/primitives';
import type { BranchNameState } from '@core/features/tasks/browser/create-task-modal/use-branch-name';
import { useTaskConfig } from '@core/features/tasks/contributions/browser/task-config/task-config-context';

interface BranchNameFieldProps {
  state: Pick<
    BranchNameState,
    | 'branchName'
    | 'setBranchName'
    | 'branchAlreadyExists'
    | 'branchPrefix'
    | 'usePrefix'
    | 'setUsePrefix'
  >;
  pushBranch?: boolean;
  onPushBranchChange?: (value: boolean) => void;
}

export function BranchNameField({ state, pushBranch, onPushBranchChange }: BranchNameFieldProps) {
  const { autoBranchName } = useTaskConfig();
  const { branchName, setBranchName, branchAlreadyExists } = state;
  const showPush = pushBranch !== undefined && onPushBranchChange !== undefined;
  const showPrefix = !autoBranchName && !!state.branchPrefix;

  return (
    <div className="flex flex-col rounded-lg border border-border px-2.5 py-2">
      <span className="flex items-center gap-1.5 text-xs text-foreground-passive">Branch name</span>
      {autoBranchName ? (
        <span className="py-1 text-sm text-foreground-muted italic">
          Branch name will be auto-generated
        </span>
      ) : (
        <>
          <Input
            bare
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="branch-name"
            className="px-0!"
          />
          {branchAlreadyExists && (
            <p className="text-muted-foreground mt-1 text-xs">
              This branch already exists — the task will check it out instead of creating a new one.
            </p>
          )}
        </>
      )}
      {(showPush || showPrefix) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-2">
          {showPrefix && (
            <div className="flex items-center gap-2">
              <Switch size="sm" checked={state.usePrefix} onCheckedChange={state.setUsePrefix} />
              <Label>Prefix with {state.branchPrefix}/</Label>
            </div>
          )}
          {showPush && (
            <div className="flex items-center gap-2">
              <Switch size="sm" checked={pushBranch} onCheckedChange={onPushBranchChange} />
              <Label>Push branch to remote</Label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
