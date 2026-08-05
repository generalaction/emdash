import { PageLayout } from '@emdash/ui/react/patterns';
import { Heading } from '@emdash/ui/react/primitives';
import type { SettingsPageProps } from '@core/primitives/settings/api/page-contribution';
import { LocalWorkspacesView } from '../components/local-workspaces-view';
import { MachineConversationsList } from '../components/machine-conversations-list';

export function LocalWorkspacesSettingsPage({ openDetail }: SettingsPageProps) {
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Workspaces"
        description="Review local project workspaces and remove stale task worktrees."
      />
      <LocalWorkspacesView openDetail={openDetail} />
      <section className="space-y-3">
        <div>
          <Heading level={2}>Conversations</Heading>
          <p className="text-sm text-foreground-muted">
            Every conversation record on this machine, including ones no longer linked to a task.
          </p>
        </div>
        <MachineConversationsList scope={{ kind: 'local' }} hostReachable />
      </section>
    </div>
  );
}
