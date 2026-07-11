# @emdash/wire Examples

These examples show the transport-agnostic primitives in `@emdash/wire`.
Each example splits the authoritative server-side primitive from the client-side
binding so the boundary looks like a real transport without adding an adapter.

## Documentation

For conceptual docs that explain how the examples fit together, see
[../docs/README.md](../docs/README.md).

Run them from the repository root:

```bash
pnpm --filter @emdash/wire run example:live-state
pnpm --filter @emdash/wire run example:batched-state
pnpm --filter @emdash/wire run example:live-log
pnpm --filter @emdash/wire run example:live-job
pnpm --filter @emdash/wire run example:mailbox
pnpm --filter @emdash/wire run example:cancellation
pnpm --filter @emdash/wire run example:contract
pnpm --filter @emdash/wire run example:api-definition
pnpm --filter @emdash/wire run example:controller
pnpm --filter @emdash/wire run example:api-client
pnpm --filter @emdash/wire run example:group
pnpm --filter @emdash/wire run example:dedupe
pnpm --filter @emdash/wire run example:job-contract
pnpm --filter @emdash/wire run example:mutation-idempotency
pnpm --filter @emdash/wire run example:multi-window
pnpm --filter @emdash/wire run example:logging
pnpm --filter @emdash/wire run example:process
pnpm --filter @emdash/wire run example:optimistic-live-model
```

Examples:

- `live-state/` demonstrates `LiveState`, the package-local protocol follower,
  cursors, mutation IDs, and resync after a generation change.
- `batched-state/` demonstrates `BatchedLiveState` coalescing multiple queued
  mutators into one emitted update.
- `live-log/` demonstrates `LiveLog` and the package-local protocol follower
  with retained tail snapshots.
- `live-job/` demonstrates progress, terminal state, result promises, and
  cancellation errors.
- `mailbox/` demonstrates bounded local producer/consumer handoff, graceful close,
  and explicit overflow.
- `cancellation/` demonstrates procedure cancellation with `AbortSignal` and
  server-side abort on disconnect.
- `contract/` demonstrates the full API flow in one file: contract definition,
  bound controller, memory transport, and typed client.
- `api-definition/` isolates contract definition with `defineContract`,
  `procedure`, `liveModel`, `liveLog`, and live model contract
  mutations.
- `controller/` isolates controller construction with `createController()` and
  direct controller calls/snapshots.
- `api-client/` isolates serving a bound controller over a memory transport,
  creating a typed `ContractClient`, and acquiring a live model replica.
- `group/` demonstrates `liveModel`, host instance lifecycle,
  typed group client binding, and mutation settling across multiple member models.
- `dedupe/` demonstrates server-side `deduplicate()` middleware for in-flight
  procedure calls.
- `job-contract/` demonstrates the contract-level `liveJob()` endpoint with start,
  progress, cancellation, terminal result, and reattach.
- `mutation-idempotency/` demonstrates mutationId-based server dedupe for live
  model contract mutations.
- `multi-window/` demonstrates one `Controller` served to multiple independent
  clients through `createWireSessionHub`.
- `replica/` demonstrates a cached middle hop with `createLiveModelReplica()`.
- `logging/` demonstrates `withLogging`, `loggingTransport`, instrumentation
  hooks, redacted debug payload logging, and live-client resync diagnostics.
- `process/` demonstrates `spawnRuntime()` and `serveWorkerProcess()` running a
  typed controller in a subprocess with restart resync.
- `optimistic-live-model/` demonstrates `OptimisticLiveModel` deriving previews
  from inline group mutation handlers and rolling back rejected mutations.
