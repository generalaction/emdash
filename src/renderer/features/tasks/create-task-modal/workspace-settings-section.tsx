import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { BranchPickerField } from './branch-picker-field';
import { CheckoutModeGroup } from './checkout-mode-group';
import type { WorkspaceModeState } from './use-workspace-mode';
import type { CreateTaskState } from './use-create-task-state';
import { WorkspacePickerField } from './workspace-picker-field';

interface WorkspaceSettingsSectionProps {
  state: CreateTaskState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  workspaceMode: WorkspaceModeState;
  useBYOI: boolean;
  setUseBYOI: (value: boolean) => void;
  isWorkspaceProviderEnabled: boolean;
}

export function WorkspaceSettingsSection({
  state,
  projectId,
  currentBranch,
  isUnborn,
  workspaceMode,
  useBYOI,
  setUseBYOI,
  isWorkspaceProviderEnabled,
}: WorkspaceSettingsSectionProps) {
  const showPrWorkspace = state.linkedType === 'pr' && state.linkedPR !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Workspace mode toggle — only for non-PR tasks */}
      {!showPrWorkspace && (
        <ToggleGroup
          className="w-full gap-1 border-none bg-transparent"
          value={[workspaceMode.mode]}
          onValueChange={([v]) => {
            if (v) workspaceMode.setMode(v as 'new' | 'existing');
          }}
        >
          <ToggleGroupItem
            className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
            value="new"
          >
            New workspace
          </ToggleGroupItem>
          <ToggleGroupItem
            className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
            value="existing"
          >
            Use existing
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      {/* Workspace content */}
      {showPrWorkspace ? (
        <CheckoutModeGroup
          value={state.checkoutMode}
          onValueChange={state.setCheckoutMode}
          pushBranch={state.branchSelection.pushBranch}
          onPushBranchChange={state.branchSelection.setPushBranch}
        />
      ) : workspaceMode.mode === 'existing' ? (
        <WorkspacePickerField
          value={workspaceMode.selectedEntry}
          onValueChange={workspaceMode.setSelectedEntry}
          worktrees={workspaceMode.worktrees}
          isPending={workspaceMode.isPending}
        />
      ) : (
        <BranchPickerField
          state={state.branchSelection}
          branchNameState={state.branchNameState}
          projectId={projectId}
          currentBranch={currentBranch}
          isUnborn={isUnborn}
          alwaysCreate
        />
      )}

      {isWorkspaceProviderEnabled && (
        <Field orientation="horizontal">
          <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
          <FieldLabel>Run on own infrastructure</FieldLabel>
        </Field>
      )}
    </div>
  );
}
