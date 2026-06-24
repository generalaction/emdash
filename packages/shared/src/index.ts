export {
  err,
  ok,
  withAbort,
  withTimeout,
  type BaseError,
  type Err,
  type Ok,
  type Result,
} from './result';
export { Emitter } from './emitter';
export { isDeepEqual } from './deep-equal';
export { toPendingLease, withLease } from './lifecycle';
export type {
  PendingLease,
  IDisposable,
  IInitializable,
  ILifecycle,
  Lease,
  Unsubscribe,
} from './lifecycle';
