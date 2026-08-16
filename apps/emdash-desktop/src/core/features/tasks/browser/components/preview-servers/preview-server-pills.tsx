import { observer } from 'mobx-react-lite';
import {
  usePreviewServers,
  useTaskComposition,
  useWorkspace,
} from '@core/features/workbench/api/browser/task-composition-context';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { ManualForwardButton } from './manual-forward-button';
import { PreviewServerPill } from './preview-server-pill';

export const PreviewServerPills = observer(function PreviewServerPills() {
  const previews = usePreviewServers();
  const taskView = useTaskComposition();
  const workspace = useWorkspace();
  const isRemoteWorkspace = Boolean(workspace.sshConnectionId);
  const servers = previews.servers;
  const liveActionDisabledReason = projectAvailabilityUi.getLiveActionDisabledReason(
    taskView.projectId
  );

  if (previews.observation.kind === 'unavailable') {
    return (
      <span className="rounded-md px-2 py-1 text-xs text-foreground-muted" tabIndex={0} role="note">
        Preview unavailable
        <span className="sr-only">
          {liveActionDisabledReason ?? 'Preview servers have not been observed.'}
        </span>
      </span>
    );
  }

  if (servers.length === 0 && !isRemoteWorkspace) return null;

  return (
    <>
      {servers.map((server) => (
        <PreviewServerPill key={server.id} server={server} />
      ))}
      {isRemoteWorkspace ? <ManualForwardButton /> : null}
      {previews.observation.kind === 'stale' && liveActionDisabledReason ? (
        <span
          className="max-w-48 truncate px-1 text-xs text-foreground-muted"
          title={liveActionDisabledReason}
          tabIndex={0}
          role="note"
        >
          Preview data is stale
        </span>
      ) : null}
    </>
  );
});
