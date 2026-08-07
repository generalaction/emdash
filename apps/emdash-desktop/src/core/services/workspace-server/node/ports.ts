import type { SshClientProxy } from '@core/primitives/ssh/api';

export type WorkspaceServerSshPort = {
  ensureProxy(connectionId: string): Promise<SshClientProxy>;
};
