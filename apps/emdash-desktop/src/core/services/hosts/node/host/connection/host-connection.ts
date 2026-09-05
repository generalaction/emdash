import { RuntimeResolveError } from '@emdash/core/primitives/runtime-resolution/api';
import { Result } from '@emdash/shared';
import { Scope } from '@emdash/shared/concurrency';
import { Readable } from '@emdash/wire/state';
import { HostAvailabilityState, HostReady } from '../../../api/availability';

export interface HostConnection {
  readonly availability: Readable<HostAvailabilityState>;
  /** Maintain interest for the scope’s lifetime; respects explicit Disconnect. */
  lease(owner: Scope): void;
  /** Maintain interest until Disconnect; overrides a previous Disconnect. */
  pin(): Promise<Result<void, RuntimeResolveError>>;
  /** Clear the pin, suppress connection work, and persist disconnected intent. */
  disconnect(): Promise<Result<void, RuntimeResolveError>>;
}
