import { observer } from 'mobx-react-lite';
import { type ReactNode } from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { asMounted, getProjectStore } from '../stores/project-selectors';
import { SshChannelUnavailablePanel } from './ssh-channel-unavailable-panel';

export const ProjectSshHealthGate = observer(function ProjectSshHealthGate({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId: string;
}) {
  const mounted = asMounted(getProjectStore(projectId));
  const sshConnectionId = mounted?.data.type === 'ssh' ? mounted.data.connectionId : undefined;
  const sshHealth = sshConnectionId ? appState.sshConnections.healthFor(sshConnectionId) : null;

  if (sshConnectionId && sshHealth?.status === 'degraded') {
    return <SshChannelUnavailablePanel />;
  }

  return <>{children}</>;
});
