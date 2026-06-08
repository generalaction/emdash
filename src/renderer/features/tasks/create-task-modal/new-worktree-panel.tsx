import { ChevronDown, GitBranch } from 'lucide-react';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { BranchNameField } from './branch-name-field';
import type { WorkspaceConfigState } from './use-workspace-config';

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
  const { branchSelection, branchNameState } = workspaceConfig;
  const { createBranchAndWorktree } = branchSelection;

  return (
    <div className="flex flex-col gap-3">
      {projectId && (
        <ProjectBranchSelector
          projectId={projectId}
          value={branchSelection.selectedBranch}
          onValueChange={branchSelection.setSelectedBranch}
          showRemoteSelectorFooter
          trigger={
            <ComboboxTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2 outline-none hover:bg-background-2 data-popup-open:bg-background-1">
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
                  <ComboboxValue placeholder="Select a branch" />
                </span>
              </div>
              <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
            </ComboboxTrigger>
          }
        />
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
