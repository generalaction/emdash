# State Ownership

Emdash has two durable state authorities:

- Desktop SQLite owns desktop entities such as projects, tasks, automations, conversations,
  and the bindings from those entities to host resources.
- Each workspace host owns the resources on its machine: repositories, worktrees,
  branches, process state, consumers, and operation-log execution records.

Do not treat a desktop workspace row as the workspace itself. For host-owned resources,
desktop rows are a materialized cache plus desktop-owned metadata and links. The host's
probe and operation log are the observed truth.

## Ownership Classes

| Class | Examples | Authority | Desktop row meaning |
| --- | --- | --- | --- |
| Desktop entities | project, task, automation, conversation | Desktop SQLite | The entity itself; tombstones are authoritative. |
| Host resources | repository, worktree, branch, path | Workspace host | Cached observation and optional desktop metadata. |
| Bindings | task to workspace, project to host | Desktop SQLite | A desktop-owned reference to a host resource. |

This means `deletedAt` on a desktop entity means the entity is deleted. A terminal marker
or removed link for a host resource means the desktop dropped its reference or intends
cleanup; the resource exists until the host observes or executes otherwise.

## Placement Rule

Place behavior where the required knowledge lives:

- Entity knowledge, cascading intent, user confirmation, tombstones, and operation claims
  belong in the desktop OperationsEngine.
- Disk/process facts, per-workspace FIFO execution, request-id dedupe, cancellation, and
  crash rehydration belong in the host workspace operation log.
- Reconciliation should split along that line: the host detects resource orphans and
  execution facts; the desktop decides whether entity state still references them and
  presents user confirmation.

Desktop claims on desktop-owned entities are locks in the authoritative database. Claims
on host resources are desktop intent arbitration only; the host operation log remains the
execution authority for those resources.

## Decisions

- Use one writer per resource. Convergence happens through live models and ordered logs,
  not by merging concurrently-written operation state.
- Keep desktop operation kinds closed in the desktop layer. Relays and hosts treat unknown
  desktop operation kinds as opaque strings unless they execute them.
- Status machines are per authority, but each status set should have an explicit transition
  table and a pure severity fold for UI rollups.
- Every durable claim must have a user-operable release path, usually retry or forget.
- Prefer re-entrant host operations over workflow history replay. If an operation cannot
  safely resume after restart, suspend it and require an explicit retry.
- Contribute behavior through manifests and definitions. Keep shared vocabulary, such as
  statuses and claim resource keys, centrally owned and mechanically reviewable.

## Enforcement

Enforce host-resource mutation through capabilities, not narrow lint rules. The workspace
runtime contract exposes the host operation log as the mutation path; direct convenience
mutations should not be added around it. Add targeted lint only after a real regression,
because preemptive function-level rules tend to become allowlist maintenance.
