# Git Runtime Architecture

The Git domain is split between a shared contract package and a host-scoped runtime package.
This lets renderer, desktop, and workspace-server code share one wire vocabulary without importing
Git process execution, file watchers, or live resource ownership.

## Ownership

- `packages/core/src/git/` owns the wire contracts, schemas, keys, serialized models and errors,
  shared port interfaces, operation context, and client-used pure helpers.
- `packages/runtime/src/git/` owns `GitRuntime`, repository and checkout sessions, live-model
  hosts, resources, mutations, Git operations, watcher invalidation, and the wire implementation.
- `@emdash/runtime` depends on `@emdash/core`; core must never import runtime.
- `GitRuntime` is host-scoped. The process or daemon hosting it determines which machine owns its
  paths and Git executable; the runtime does not branch on local versus SSH machines.

## Runtime Lifecycle

- `GitRuntime` is the composition root. It owns the shared Git executor, watch service, object-store
  mutex, and `GitSessionManager`.
- `GitSessionManager` owns repository and checkout leases. Repository resources are keyed by their
  common Git directory; checkout resources are keyed by their top-level working tree.
- Opening a checkout retains its repository resource. Closing sessions releases their leases, and
  disposing the runtime releases all sessions, live hosts, and an internally owned watcher.

## Wire Composition

`gitContract` is defined in core. Runtime exposes two server-side entry points:

- `createGitContractImpl(runtime, contract)` returns a reusable implementation that can be mounted
  at a nested contract path such as `workspaceWireContract.git`.
- `createGitController(runtime)` serves the standalone `gitContract`.

Contract nesting changes live-model IDs. The reusable implementation therefore adapts runtime live
hosts to the mounted contract and rewrites mutation cursor model IDs at that boundary.

Clients should import contracts, models, and errors from `@emdash/core/git`. Only a process that
hosts Git execution should import `@emdash/runtime/git`.
