import { Button, Combobox } from '@emdash/ui/react/primitives';
import { ChevronDown, GitBranch, Layers } from 'lucide-react';
import { ProjectBranchSelector } from '@core/features/source-control/contributions/browser/project-branch-selector';
import type { WorkspaceConfigState } from '@core/features/tasks/api/browser/create-task-modal/use-workspace-config';
import { BranchNameField } from './branch-name-field';

export type WorkspacePanelProps = {
  workspaceConfig: WorkspaceConfigState;
  projectId?: string;
  isUnborn?: boolean;
};

export function NewWorktreePanel({
  workspaceConfig,
  projectId,
  isUnborn = false,
}: WorkspacePanelProps) {
  const { branchSelection, branchNameState, branchConflict } = workspaceConfig;
  const { createBranchAndWorktree } = branchSelection;

  function handleReuseExisting() {
    workspaceConfig.setPresetId('use-existing');
    if (branchConflict?.workspaceId) {
      workspaceConfig.setSelectedWorkspaceId(branchConflict.workspaceId);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {projectId && (
        <ProjectBranchSelector
          projectId={projectId}
          value={branchSelection.selectedBranch}
          onValueChange={branchSelection.setSelectedBranch}
          showRemoteSelectorFooter
          trigger={
            <Combobox.Trigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2 outline-none hover:bg-background-2 data-popup-open:bg-background-1">
              <div className="flex flex-col gap-1 text-left text-sm">
                <span className="text-xs text-foreground-passive">
                  {createBranchAndWorktree ? 'From branch' : 'Branch'}
                </span>
                <span className="flex items-center gap-1">
                  <GitBranch
                    absoluteStrokeWidth
                    strokeWidth={2}
                    className="size-3.5 shrink-0 text-foreground-muted"
                  />
                  <Combobox.Value placeholder="Select a branch" />
                </span>
              </div>
              <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
            </Combobox.Trigger>
          }
        />
      )}

      {!createBranchAndWorktree && branchConflict && (
        <div className="flex flex-col gap-2 rounded-md border border-border-warning bg-background-warning px-3 py-2.5 text-xs text-foreground-warning">
          <p>
            <strong className="font-medium">{branchConflict.branchName}</strong> is already checked
            out in{' '}
            {branchConflict.taskName ? (
              <>
                task <strong className="font-medium">{branchConflict.taskName}</strong>
              </>
            ) : (
              'an existing workspace'
            )}
            . A new isolated worktree cannot be created for a branch that is already in use.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReuseExisting}
            className="gap-1.5 self-start border-border-warning bg-transparent text-foreground-warning hover:bg-background-warning-hover hover:text-foreground-warning"
          >
            <Layers className="size-3.5" />
            Reuse existing workspace
          </Button>
        </div>
      )}

      {createBranchAndWorktree && !isUnborn && (
        <BranchNameField
          state={branchNameState}
          pushBranch={branchSelection.pushBranch}
          onPushBranchChange={branchSelection.setPushBranch}
        />
      )}
    </div>
  );
}
