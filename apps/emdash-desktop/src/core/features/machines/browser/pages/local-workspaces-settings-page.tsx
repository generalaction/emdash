import { PageLayout } from '@emdash/ui/react/patterns';
import { Button } from '@emdash/ui/react/primitives';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SettingsPageProps } from '@core/primitives/settings/api/page-contribution';
import { WorkspacesListView } from '../components/workspaces-list-view';

export function LocalWorkspacesSettingsPage({ openDetail }: SettingsPageProps) {
  const openCleanup = useOpenModal('workspaceCleanupModal');
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Workspaces"
        description="Review local project workspaces and remove stale task worktrees."
        actions={
          <Button variant="secondary" onClick={() => void openCleanup()}>
            Clean up…
          </Button>
        }
      />
      <WorkspacesListView scope={{ kind: 'local' }} openDetail={openDetail} />
    </div>
  );
}
