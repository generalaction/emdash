import type { RuntimeResolveError } from '@emdash/core/primitives/runtime-resolution/api';
import type { Result } from '@emdash/shared';
import type { WorkspaceServerConnection } from '../../node/workspace-server/connect/wire-connection-manager';
import type { HostReady } from '../availability';

export type HostClientOptions = {
  signal?: AbortSignal;
  waitForReady?: boolean;
};

export interface HostRuntimeAccess {
  /** Observes readiness without acquiring a lease or pin. */
  waitUntilReady(signal?: AbortSignal): Promise<Result<HostReady, RuntimeResolveError>>;
  client(options?: HostClientOptions): Promise<WorkspaceServerConnection>;
}
