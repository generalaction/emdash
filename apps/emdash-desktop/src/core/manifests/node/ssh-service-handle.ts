import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import type { SshService } from '@core/primitives/ssh/api';
import type {
  SshConnectionControl,
  SshConnectionLifecycle,
} from '@core/primitives/ssh/api/node/connection-control';
import type { SshConnectionManager } from '@core/primitives/ssh/api/node/ssh-connection-manager';
import type { SshConnectionsModel } from '@core/services/ssh/node/connections-model';
import type { HostTrustRequests } from '@core/services/ssh/node/host-trust-requests';

export interface SshServiceHandle {
  readonly trust: HostTrustRequests;
  readonly control: SshConnectionControl;
  bindLifecycle(lifecycle: SshConnectionLifecycle): void;
  readonly ssh: SshService;
  readonly machines: MachinesService;
  readonly manager: SshConnectionManager;
  readonly connections: SshConnectionsModel;
  dispose(): Promise<void>;
}
