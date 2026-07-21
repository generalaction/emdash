import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import type { SshConnectionsModel } from '@core/services/ssh/node/connections-model';
import type { SshConnectionManager } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import type { SshService } from '@core/services/ssh/node/ssh-service';

export interface SshServiceHandle {
  readonly ssh: SshService;
  readonly machines: MachinesService;
  readonly manager: SshConnectionManager;
  readonly connections: SshConnectionsModel;
  dispose(): Promise<void>;
}
