import { ExistingWorkspacePicker } from './existing-workspace-picker';
import type { WorkspacePanelProps } from './new-worktree-panel';

export function UseExistingPanel({ workspaceConfig }: WorkspacePanelProps) {
  return (
    <ExistingWorkspacePicker
      workspaces={workspaceConfig.workspaceOptions}
      isLoading={workspaceConfig.workspaceOptionsLoading}
      selectedWorkspaceId={workspaceConfig.selectedWorkspaceId}
      onSelect={workspaceConfig.setSelectedWorkspaceId}
    />
  );
}
