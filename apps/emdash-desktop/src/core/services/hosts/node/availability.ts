import { sshConnectionIdOf, type HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/primitives/runtime-resolution/api';
import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { expose, peek, type Readable } from '@emdash/wire/state';
import { hostReadyResult } from '../api/availability';
import type {
  BrowserHostWakeCause,
  ExplicitRecoveryCause,
  HostAvailability,
  HostAvailabilityState,
  HostReady,
  HostWakeCause,
  RecoveryCause,
} from '../api/availability';
import { hostsContract } from '../api/contract';
import type { HostConnection } from '../api/node/host-connection';

export type RemoteHostAvailability = {
  connection: HostConnection;
  waitUntilReady(): Promise<Result<HostReady, RuntimeResolveError>>;
};

export type CreateHostAvailabilityOptions = {
  scope: Scope;
  local: HostAvailability;
  remote(connectionId: string): RemoteHostAvailability;
  remoteState(connectionId: string): Readable<HostAvailabilityState>;
  remoteLease(connectionId: string, owner: Scope): void;
  wakeRemote(cause: BrowserHostWakeCause): void;
  revalidateRemote(connectionId: string, cause: BrowserHostWakeCause): void;
};

/** Routes availability and exposes its Wire model. Recovery belongs to the selected Host owner. */
export class HostAvailabilityService implements HostAvailability {
  readonly host: LeasedLiveModelProvider<typeof hostsContract.availability>;

  constructor(private readonly options: CreateHostAvailabilityOptions) {
    this.host = expose(hostsContract.availability, { state: ({ host }) => this.state(host) });
    options.scope.add(() => this.host.dispose());
  }

  state(host: HostRef): Readable<HostAvailabilityState> {
    const id = sshConnectionIdOf(host);
    return id ? this.options.remoteState(id) : this.options.local.state(host);
  }

  stateFor(host: HostRef): HostAvailabilityState {
    return peek(this.state(host));
  }

  requireReady(host: HostRef): Result<HostReady, RuntimeResolveError> {
    return hostReadyResult(host, this.stateFor(host));
  }

  lease(host: HostRef, owner: Scope): void {
    const id = sshConnectionIdOf(host);
    if (id) this.options.remoteLease(id, owner);
    else this.options.local.lease(host, owner);
  }

  wake(host: HostRef, cause: HostWakeCause): void {
    const id = sshConnectionIdOf(host);
    if (id) this.options.revalidateRemote(id, cause === 'ssh-edge' ? 'online' : cause);
    else this.options.local.wake(host, cause);
  }

  wakeDemanded(cause: BrowserHostWakeCause): void {
    this.options.wakeRemote(cause);
    this.options.local.wakeDemanded(cause);
  }

  async ensureReady(
    host: HostRef,
    cause: RecoveryCause
  ): Promise<Result<HostReady, RuntimeResolveError>> {
    const id = sshConnectionIdOf(host);
    if (!id) return this.options.local.ensureReady(host, cause);
    // Capture one identity before awaiting intent persistence. This wait must not migrate.
    const remote = this.options.remote(id);
    if (cause === 'connect' || cause === 'retry') {
      const pinned = await remote.connection.pin();
      if (!pinned.success) return pinned;
    }
    return remote.waitUntilReady();
  }

  requestReady(host: HostRef, cause: ExplicitRecoveryCause): void {
    void this.ensureReady(host, cause);
  }

  invalidate(host: HostRef, issue?: RuntimeResolveError): void {
    const id = sshConnectionIdOf(host);
    if (id) this.options.revalidateRemote(id, 'online');
    else this.options.local.invalidate(host, issue);
  }

  suspend(host: HostRef): void {
    const id = sshConnectionIdOf(host);
    if (id) void this.options.remote(id).connection.disconnect();
    else this.options.local.suspend(host);
  }
}

export function createHostAvailability(
  options: CreateHostAvailabilityOptions
): HostAvailabilityService {
  return new HostAvailabilityService(options);
}
