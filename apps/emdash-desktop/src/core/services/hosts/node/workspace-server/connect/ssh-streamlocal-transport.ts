import type { WireTransport } from '@emdash/wire/rpc';
import type { SshWorkspaceServerTarget } from '../../../api/targets';
import type { WorkspaceServerSshPort } from '../ports';
import { ownedStreamTransport } from './owned-stream-transport';
import { workspaceRelayCommand } from './stdio-relay';

export async function openSshWorkspaceServerTransport(
  target: SshWorkspaceServerTarget,
  ssh: WorkspaceServerSshPort,
  options?: { signal?: AbortSignal }
): Promise<WireTransport> {
  const proxy = await ssh.ensureProxy(target.sshConnectionId);
  const channel = await proxy.openStream(workspaceRelayCommand(target.socketPath), options);
  return ownedStreamTransport(channel);
}
