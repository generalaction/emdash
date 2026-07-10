# Git Runtime Architecture

Git is split into a transport contract and a host-scoped runtime. Renderer, desktop, and
workspace-server code share the Wire vocabulary without importing Git execution, host paths,
watchers, or lease ownership.

## Ownership

- `packages/core/src/git/` owns selectors, contracts, serialized states, inputs, results, errors,
  and client-used pure helpers.
- `packages/runtime/src/git/` owns provisioning, identity resolution, Git execution, canonical
  mounts, watchers, effect routing, leases, and the contract adapter.
- `packages/wire/` owns live-state publication, `ComputedLiveState`, leased live-model providers,
  mutation cursors, jobs, replicas, and transport behavior.
- Core never imports runtime. Canonical identities and canonical host paths are runtime-only.

## Layers

1. `GitRepositoryProvisioner` inspects, initializes, and clones paths before a mount exists.
2. `GitRepository` and `GitCheckout` are execution capabilities. They run commands and fresh reads;
   they do not own live states, watchers, or leases.
3. `RepositoryMount` and `CheckoutMount` own computed live states and watcher invalidation. One
   repository-family lane orders commands and authoritative refreshes.
4. `GitAllocationGraph` resolves selectors, pools mounts by canonical identity, retains a parent
   repository for every checkout, and disposes idle mounts after the configured TTL.
5. `GitContractAdapter` acquires selector-bound handles for each call. State attachments and jobs
   hold their leases for their full lifetime.

Repository identity is the canonical common Git directory. Checkout identity combines the
canonical checkout root and private Git directory. Linked worktrees therefore share one repository
mount while retaining distinct checkout mounts.

## Live State and Mutations

Repository live states are `refs`, `remotes`, `stashes`, and `worktrees`. Checkout live states are
`status` and `head`. File diffs remain on-demand queries; a bounded, target-aware staleness state
lets consumers invalidate cached diff content cheaply.

Watchers and commands feed the same Git-effect router. Mutations use three reconciliation classes:

- settle: await an authoritative refresh and return the existing Wire success cursor;
- eager: invalidate and refresh promptly when observed, without delaying the result;
- background: mark dirty and converge while observed or on the next acquisition.

Only stage and unstage operations settle `status` initially. Other commands return authoritative
domain results without a generalized cross-model settlement protocol. Cross-domain effects, such
as a checkout commit invalidating repository refs, are explicit background effects.

## Source Organization

- `git-runtime.ts` is the host-facing facade and composition root.
- `api/` adapts the Git contract to runtime operations, grouped by repository, checkout, and file
  diff ownership.
- `allocation/` owns canonical identities, handles, mounts, effect planning, watcher
  classification, ordering, and idle disposal.
- `exec/` owns Git process construction, operation context, repository binding, and transfer
  progress.
- `repository/` and `checkout/` own command execution capabilities and their parsing helpers.

Only runtime and transport composition are exported from `@emdash/runtime/git`. Allocation,
execution capabilities, and mounts remain implementation details.

## Wire Composition

`gitContract` uses reconnect-stable path selectors and has no public open/close procedures.
`LeasedLiveModelProvider` connects state acquisition to runtime leases.
`createGitContractAdapter()` returns an implementation plus explicit disposal for mounting Git
beneath a parent contract, while `createGitController()` serves the standalone contract.

Clients import contracts, state types, and errors from `@emdash/core/git`. Only a process hosting Git
execution imports `@emdash/runtime/git`.
