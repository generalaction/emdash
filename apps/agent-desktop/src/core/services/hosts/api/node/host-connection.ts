import type { RuntimeResolveError } from '@agent/core/primitives/runtime-resolution/api';
import type { Result } from '@agent/shared';
import type { Scope } from '@agent/shared/concurrency';
import type { Readable } from '@agent/wire/state';
import type { HostAvailabilityState } from '../availability';

/** Registers intent; availability reports the independent outcome of supervised connection work. */
export interface HostConnection {
  readonly availability: Readable<HostAvailabilityState>;
  /** Maintain interest for the scope's lifetime; respects explicit Disconnect. */
  lease(owner: Scope): void;
  /** Maintain interest until Disconnect; overrides a previous Disconnect. */
  pin(): Promise<Result<void, RuntimeResolveError>>;
  /** Clear the pin and suppress all connection work, including existing leases. */
  disconnect(): Promise<Result<void, RuntimeResolveError>>;
}
