import { PageLayout } from '@emdash/ui/react/patterns';
import type { SettingsPageProps } from '@core/primitives/settings/api/page-contribution';
import { LocalWorkspacesView } from '../components/local-workspaces-view';

export function LocalWorkspacesSettingsPage({ openDetail }: SettingsPageProps) {
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Workspaces"
        description="Review local project workspaces and remove stale task worktrees."
      />
      <LocalWorkspacesView openDetail={openDetail} />
    </div>
  );
}
