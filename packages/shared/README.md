# @emdash/shared

`@emdash/shared` owns package-level foundations that are reused by Wire, Core,
desktop, workspace-server, and tests. These primitives are intentionally generic:
they do not define product domains, Wire protocol messages, or host-specific
process behavior.

## Foundation Exports

- `@emdash/shared/concurrency`: `Scope`, `Run`, `LifecycleRegistry`, `Machine`,
  machine effect drivers, `Mailbox`, `ResourceCache`, `SharedResource`,
  `AsyncCache`, bounded buffers, and disposable helpers.
- `@emdash/shared/scheduling`: `Clock`, `systemClock`, `TimerHandle`,
  `runWithTimeout()`, `TimeoutError`, retry schedules, and `retry()`.
- `@emdash/shared/testing`: `ManualClock`, `createDeferred()`, `waitFor()`, and
  stub logger helpers.
- `@emdash/shared/util`: stable utility helpers such as `stableStringify()`.
- `@emdash/shared/result`: `Result<T, E>` and result helpers.

## Choosing Lifecycle Primitives

Use `Scope` for ownership, cancellation, cleanup ordering, and async work that
must not outlive its feature. Use `scope.add()` and `scope.use()` for finalizers,
`scope.child()` for nested ownership, and `scope.run()` for tracked async work.

Use `LifecycleRegistry` when a feature owns a keyed set of local resources with
explicit `start()` and `stop()` commands, typed start/stop results, queryable
state, and state-change observers. It is a state registry, not a lease cache or
protocol primitive.

Use `Machine` when a feature owns a local command/event/effect protocol: commands
decide domain events, events evolve state, and effects are interpreted at the
host boundary. Machines are protocol-free; bind them to Wire `LiveState` only at
the Wire layer.

Use `ResourceCache` when resource lifetime is demand-driven: consumers call
`acquire()`, hold leases, release them, and optionally benefit from an idle TTL.
Use `SharedResource` for the same lease behavior around one unkeyed resource, and
`AsyncCache` for retryable cached async values with no finalizer.

Use Wire-owned primitives when the lifecycle is protocol-specific. `WorkerSlot`
belongs to `@emdash/wire/worker` because it supervises process generations and
keeps a stable typed Wire client. `LiveJob` belongs to `@emdash/wire/live`
because it publishes cancellable job state, progress, retention, and remote
client handles.

## Import Guidance

Import generic foundations from the Shared subpaths directly. Wire-specific
`compose()` and `deduplicate()` remain in `@emdash/wire/util`, and Wire
worker/process APIs remain in `@emdash/wire/worker`.
