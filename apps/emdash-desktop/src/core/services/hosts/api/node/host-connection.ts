import type { RuntimeResolveError } from '@emdash/core/primitives/runtime-resolution/api';
import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Readable } from '@emdash/wire/state';
import type {
  BrowserHostWakeCause,
  HostAvailabilityState,
  HostDemandLease,
  HostDemandMode,
  HostReady,
  RecoveryCause,
} from '../availability';

/** Host policy commands. Physical transports, mutable state, and attempt ownership stay private. */
export interface HostConnection {
  readonly availability: Readable<HostAvailabilityState>;
  demand(mode: HostDemandMode, owner: Scope): HostDemandLease;
  requestConnect(): Promise<Result<void, RuntimeResolveError>>;
  ensureReady(
    cause: RecoveryCause,
    signal?: AbortSignal
  ): Promise<Result<HostReady, RuntimeResolveError>>;
  revalidate(cause: BrowserHostWakeCause | 'retry'): void;
  /** Disconnect persistence failures propagate to the caller. */
  disconnect(): Promise<void>;
}
