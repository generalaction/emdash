import { streamTransport, type WireTransport } from '@emdash/wire';
import type { ClientChannel } from 'ssh2';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import type { SshWorkspaceServerTarget } from './workspace-server-client-source';

export type WorkspaceServerSshConnectionManager = {
  connect(connectionId: string): Promise<SshClientProxy>;
};

export async function openSshWorkspaceServerTransport(
  target: SshWorkspaceServerTarget,
  manager: WorkspaceServerSshConnectionManager
): Promise<WireTransport> {
  const proxy = await manager.connect(target.sshConnectionId);
  const channel = await proxy.forwardOutStreamLocal(target.socketPath);
  return ownedStreamlocalTransport(channel);
}

export function ownedStreamlocalTransport(channel: ClientChannel): WireTransport {
  const transport = streamTransport(channel, channel);
  let closed = false;
  return {
    ...transport,
    close() {
      if (closed) return;
      closed = true;
      transport.close?.();
      channel.destroy();
    },
  };
}
