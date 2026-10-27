import type { RuntimeResolveError } from '@agent/core/primitives/runtime-resolution/api';
import type { Result } from '@agent/shared';
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
