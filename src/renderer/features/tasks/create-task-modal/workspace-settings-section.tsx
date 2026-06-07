import { BranchPickerField } from './branch-picker-field';
import { ExistingWorkspacePicker, useProjectWorkspaces } from './existing-workspace-picker';
import { PrWorkspacePresetPicker } from './pr-workspace-preset-picker';
import { SetupStepPreview } from './setup-step-preview';
import type { CreateTaskState } from './use-create-task-state';
import { WorkspaceModePicker } from './workspace-mode-picker';

interface WorkspaceSettingsSectionProps {
  state: CreateTaskState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  isWorkspaceProviderEnabled: boolean;
}

export function WorkspaceSettingsSection({
  state,
  projectId,
  currentBranch,
  isUnborn = false,
  isWorkspaceProviderEnabled,
}: WorkspaceSettingsSectionProps) {
  const { workspaceConfig } = state;
  const hasPR = state.linkedType === 'pr' && state.linkedPR !== null;
  const { data: existingWorkspaces = [] } = useProjectWorkspaces(projectId);

  return (
    <div className="flex flex-col gap-4">
      <WorkspaceModePicker
        value={workspaceConfig.mode}
        onValueChange={workspaceConfig.setMode}
        hasExistingWorkspaces={existingWorkspaces.length > 0}
        isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
        isUnborn={isUnborn}
      />

      {workspaceConfig.mode === 'existing' && (
        <ExistingWorkspacePicker
          projectId={projectId}
          selectedWorkspaceId={workspaceConfig.selectedWorkspaceId}
          onSelect={workspaceConfig.setSelectedWorkspaceId}
        />
      )}

      {workspaceConfig.mode === 'new-worktree' && (
        <div className="flex flex-col gap-3">
          {hasPR ? (
            <PrWorkspacePresetPicker
              presetId={workspaceConfig.presetId}
              onPresetChange={workspaceConfig.setPresetId}
              branchSelection={workspaceConfig.branchSelection}
              branchNameState={workspaceConfig.branchNameState}
            />
          ) : (
            <BranchPickerField
              state={workspaceConfig.branchSelection}
              branchNameState={workspaceConfig.branchNameState}
              projectId={projectId}
              currentBranch={currentBranch}
              isUnborn={isUnborn}
            />
          )}
          <SetupStepPreview steps={workspaceConfig.setupSteps} />
        </div>
      )}

      {workspaceConfig.mode === 'sandbox' && (
        <p className="text-xs text-foreground-muted">
          A remote sandbox will be provisioned using your workspace provider script when this task
          starts.
        </p>
      )}
    </div>
  );
}
