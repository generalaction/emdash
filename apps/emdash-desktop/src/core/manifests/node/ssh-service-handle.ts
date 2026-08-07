import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import type { SshConnectionManager, SshService } from '@core/primitives/ssh/api';
import type { SshConnectionsModel } from '@core/services/ssh/node/connections-model';

export interface SshServiceHandle {
  readonly ssh: SshService;
  readonly machines: MachinesService;
  readonly manager: SshConnectionManager;
  readonly connections: SshConnectionsModel;
  dispose(): Promise<void>;
}
