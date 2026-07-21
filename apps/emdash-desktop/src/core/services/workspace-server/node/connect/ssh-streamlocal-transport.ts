import type { WireTransport } from '@emdash/wire';
import type { WorkspaceServerSshPort } from '../ports';
import type { SshWorkspaceServerTarget } from '../targets';
import { ownedStreamTransport } from './owned-stream-transport';

export async function openSshWorkspaceServerTransport(
  target: SshWorkspaceServerTarget,
  ssh: WorkspaceServerSshPort
): Promise<WireTransport> {
  const proxy = await ssh.ensureProxy(target.sshConnectionId);
  const channel = await proxy.forwardOutStreamLocal(target.socketPath);
  return ownedStreamTransport(channel);
}
