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
pnpm --filter @emdash/wire run example:live-log
pnpm --filter @emdash/wire run example:live-job
pnpm --filter @emdash/wire run example:mailbox
pnpm --filter @emdash/wire run example:cancellation
pnpm --filter @emdash/wire run example:api-definition
pnpm --filter @emdash/wire run example:dedupe
pnpm --filter @emdash/wire run example:job-contract
```

Examples:

- `live-state/` demonstrates `LiveState`, the package-local protocol follower,
  cursors, mutation IDs, and resync after a generation change.
- `live-log/` demonstrates `LiveLog` and the package-local protocol follower
  with retained tail snapshots.
- `live-job/` demonstrates progress, terminal state, result promises, and
  cancellation errors.
- `mailbox/` demonstrates bounded local producer/consumer handoff, graceful close,
  and explicit overflow.
- `cancellation/` demonstrates procedure cancellation with `AbortSignal` and
  server-side abort on disconnect.
- `api-definition/` isolates contract definition with `defineContract`,
  `procedure`, `liveModel`, `liveLog`, and live model contract
  mutations.
- `dedupe/` demonstrates server-side `deduplicate()` middleware from
  `@emdash/shared/requests` for in-flight procedure calls.
- `job-contract/` demonstrates the contract-level `liveJob()` endpoint with start,
  progress, cancellation, terminal result, and reattach.
