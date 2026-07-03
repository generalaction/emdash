import { observer } from 'mobx-react-lite';
import { usePreviewServers, useWorkspace } from '@renderer/features/tasks/task-view-context';
import { ManualForwardButton } from './manual-forward-button';
import { PreviewServerPill } from './preview-server-pill';
import { PreviewServersBadge } from './preview-servers-badge';

export const PreviewServerPills = observer(function PreviewServerPills() {
  const previews = usePreviewServers();
  const workspace = useWorkspace();
  const isRemoteWorkspace = Boolean(workspace.sshConnectionId);
  const servers = previews.servers;

  if (servers.length === 0 && !isRemoteWorkspace) return null;

  return (
    <>
      {servers.length > 1 ? (
        <PreviewServersBadge servers={servers} />
      ) : (
        servers.map((server) => <PreviewServerPill key={server.id} server={server} />)
      )}
      {isRemoteWorkspace ? <ManualForwardButton /> : null}
    </>
  );
});
