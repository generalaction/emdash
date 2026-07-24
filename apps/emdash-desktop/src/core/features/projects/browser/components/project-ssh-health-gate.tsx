import { observer } from 'mobx-react-lite';
import { type ReactNode } from 'react';
import { getProjectStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import { SshChannelUnavailablePanel } from './ssh-channel-unavailable-panel';

export const ProjectSshHealthGate = observer(function ProjectSshHealthGate({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId: string;
}) {
  const data = getProjectStore(projectId)?.data;
  const sshConnectionId = data?.type === 'ssh' ? data.connectionId : undefined;
  const sshHealth = sshConnectionId ? appState.machines.healthFor(sshConnectionId) : null;

  if (sshConnectionId && sshHealth?.status === 'degraded') {
    return <SshChannelUnavailablePanel />;
  }

  return <>{children}</>;
});
