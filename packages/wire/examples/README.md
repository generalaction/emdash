# @emdash/wire Examples

These examples show the transport-agnostic primitives in `@emdash/wire`.
Each example splits the authoritative server-side primitive from the client-side
binding so the boundary looks like a real transport without adding an adapter.

Run them from the repository root:

```bash
pnpm --filter @emdash/wire run example:live-model
pnpm --filter @emdash/wire run example:batched-model
pnpm --filter @emdash/wire run example:live-log
pnpm --filter @emdash/wire run example:live-job
pnpm --filter @emdash/wire run example:mutations
pnpm --filter @emdash/wire run example:contract
pnpm --filter @emdash/wire run example:api-definition
pnpm --filter @emdash/wire run example:api-binding
pnpm --filter @emdash/wire run example:api-client
```

Examples:

- `live-model/` demonstrates `LiveModelServer`, `LiveModelClient`, cursors,
  mutation IDs, and resync after a generation change.
- `batched-model/` demonstrates `BatchedLiveModel` coalescing multiple queued
  mutators into one emitted update.
- `live-log/` demonstrates `LiveLogServer` and `LiveLogClient` with retained
  tail snapshots.
- `live-job/` demonstrates progress, terminal state, result promises, and
  cancellation errors.
- `mutations/` demonstrates `LiveModelRegistry`, `MutationContext`,
  `liveMutation`, `LiveBindingRegistry`, and `createLiveMutationsClient` across
  multiple model instances.
- `contract/` demonstrates the full API flow in one file: contract definition,
  bound controller, memory transport, and typed client.
- `api-definition/` isolates contract definition with `defineContract`,
  `procedure`, `liveModelRef`, and `liveLogRef`.
- `api-binding/` isolates controller construction with `bind()` and direct
  controller calls/snapshots.
- `api-client/` isolates serving a bound controller over a memory transport and
  creating a typed `contractClient`.
