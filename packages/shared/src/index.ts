// Result is exported as a value (which also carries the type for type-position usage).
// All other result types use inline 'type' to keep them type-only.
export {
  andThen,
  andThenAsync,
  err,
  fail,
  gen,
  genAsync,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  orElse,
  Result,
  sequence,
  sequenceAll,
  tap,
  tapErr,
  toSerializedError,
  tryCatch,
  tryCatchAsync,
  unwrapGen,
  unwrapGenAsync,
  unwrapOr,
  unwrapOrElse,
  withAbort,
  withTimeout,
  type BaseError,
  type DataOf,
  type Err,
  type ErrorOf,
  type Ok,
  type Serializable,
  type SerializedError,
} from './result/index';
export { Emitter } from './emitter';
export { isDeepEqual } from './deep-equal';
export { once, toPendingLease, withLease } from './lifecycle';
export type {
  PendingLease,
  IDisposable,
  IInitializable,
  ILifecycle,
  IReleasable,
  Lease,
  Unsubscribe,
} from './lifecycle';
