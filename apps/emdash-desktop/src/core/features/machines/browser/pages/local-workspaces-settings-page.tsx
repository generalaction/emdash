import { PageLayout } from '@emdash/ui/react/patterns';
import { LocalWorkspacesView } from '../components/local-workspaces-view';

export function LocalWorkspacesSettingsPage() {
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Workspaces"
        description="Review local project workspaces and remove stale task worktrees."
      />
      <LocalWorkspacesView />
    </div>
  );
}
