import { PageLayout } from '@emdash/ui/react/patterns';
import { MachineWorkspacesList } from '../components/machine-workspaces-list';

export function LocalWorkspacesSettingsPage() {
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Workspaces"
        description="Review local project workspaces and remove stale task worktrees."
      />
      <MachineWorkspacesList scope="local" enabled />
    </div>
  );
}
