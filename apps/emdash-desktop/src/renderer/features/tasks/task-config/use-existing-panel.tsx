import { ExistingWorkspacePicker } from './existing-workspace-picker';
import type { WorkspacePanelProps } from './new-worktree-panel';

export function UseExistingPanel({ workspaceConfig, projectId }: WorkspacePanelProps) {
  return (
    <ExistingWorkspacePicker
      projectId={projectId}
      selectedWorkspaceId={workspaceConfig.selectedWorkspaceId}
      onSelect={workspaceConfig.setSelectedWorkspaceId}
    />
  );
}
