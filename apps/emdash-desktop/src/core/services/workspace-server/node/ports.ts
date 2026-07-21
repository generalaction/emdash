import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';

export type WorkspaceServerSshPort = {
  ensureProxy(connectionId: string): Promise<SshClientProxy>;
};
