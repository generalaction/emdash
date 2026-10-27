import { ToggleGroup } from '@emdash/ui/react/primitives';
import { CheckoutPrPanel } from '@core/features/tasks/browser/task-config/checkout-pr-panel';
import { NewWorktreePanel } from '@core/features/tasks/browser/task-config/new-worktree-panel';
import type { WorkspacePanelProps } from '@core/features/tasks/browser/task-config/new-worktree-panel';
import { PrNewBranchPanel } from '@core/features/tasks/browser/task-config/pr-new-branch-panel';
import { UseExistingPanel } from '@core/features/tasks/browser/task-config/use-existing-panel';
import { WorkspacePresetPicker } from '@core/features/tasks/browser/task-config/workspace-preset-picker';
import { WorktreeDestinationPreview } from '@core/features/tasks/browser/task-config/worktree-destination-preview';
import { useTaskState } from '@core/features/tasks/contributions/browser/task-config/task-state-context';
import type { WorkspacePresetId } from '@core/primitives/workspaces/api';

const PRESET_PANELS: Record<
  Exclude<WorkspacePresetId, 'repo-root'>,
  React.ComponentType<WorkspacePanelProps>
> = {
  'new-worktree': NewWorktreePanel,
  'use-existing': UseExistingPanel,
  'checkout-pr': CheckoutPrPanel,
  'pr-new-branch': PrNewBranchPanel,
};

/** Presets with no configurable settings — no panel is rendered for these. */
const PRESETS_WITHOUT_SETTINGS = new Set<WorkspacePresetId>(['repo-root']);

export function WorkspaceSettingsSection() {
  const { workspaceConfig, projectId, isUnborn, hasRepository, hasPR, requestProvider } =
    useTaskState();

  const { presetId, branchSelection } = workspaceConfig;
  const { createBranchAndWorktree, setCreateBranchAndWorktree } = branchSelection;

  const worktreesDisabledReason = !hasRepository
    ? 'Folder is not a Git repository'
    : isUnborn
      ? 'Repository has no commits yet'
      : undefined;
  const hasSettings = !PRESETS_WITHOUT_SETTINGS.has(presetId);
  const Panel = PRESET_PANELS[presetId as Exclude<WorkspacePresetId, 'repo-root'>];

  return (
    <div className="flex flex-col gap-4">
      <WorkspacePresetPicker
        value={presetId}
        onValueChange={workspaceConfig.setPresetId}
        hasPR={hasPR}
        requestProvider={requestProvider}
        hasExistingWorkspaces={workspaceConfig.workspaceOptions.some(
          (workspace) => !!workspace.workspaceId && !workspace.disabledReason
        )}
        worktreesDisabledReason={worktreesDisabledReason}
      />
      {presetId === 'new-worktree' && (
        <ToggleGroup.Root
          className="w-full"
          value={[createBranchAndWorktree ? 'create' : 'checkout']}
          onValueChange={([v]) => {
            if (v) setCreateBranchAndWorktree(v === 'create');
          }}
        >
          <ToggleGroup.Item className="flex-1 text-xs" value="checkout">
            Checkout branch
          </ToggleGroup.Item>
          <ToggleGroup.Item className="flex-1 text-xs" value="create">
            Create new branch
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      )}
      {hasSettings && (
        <Panel
          workspaceConfig={workspaceConfig}
          projectId={projectId}
          isUnborn={isUnborn}
          requestProvider={requestProvider}
        />
      )}
      {projectId ? (
        <WorktreeDestinationPreview
          projectId={projectId}
          workspaceConfig={workspaceConfig.resolvedConfig}
        />
      ) : null}
    </div>
  );
}
