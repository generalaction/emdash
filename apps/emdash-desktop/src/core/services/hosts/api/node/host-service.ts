import type { HostRef } from '@emdash/core/primitives/host/api';
import type { HostConnection } from './host-connection';
import type { HostRuntimeAccess } from './host-runtime';
import type { HostWorkspaceServer } from './host-workspace-server';

/** Services for one Host identity. Reacquire from Hosts after machine identity replacement. */
export interface HostService {
  readonly host: HostRef;
  readonly connection: HostConnection;
  readonly runtime: HostRuntimeAccess;
  readonly server: HostWorkspaceServer;
}
