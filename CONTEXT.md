# Emdash

Emdash runs AI coding agents in parallel across isolated git worktrees on local and remote machines. The desktop app coordinates; workspace hosts execute.

## Language

### The model

**Inventory-and-command model**:
Emdash's state model for host artifacts: the host's inventory is authoritative, the desktop Registry converges toward it, and the only way to change host state is a one-shot durable command. There is no standing desired state — emdash never re-converges the world toward a record. See ADR 0001.
_Avoid_: Spec/status, desired state, reconciling the host (the record reconciles, the host does not)

### Places and artifacts

**Host**:
A machine emdash can reach and run commands on — the local machine or an SSH-connected remote. Authoritative for everything that physically exists on it.
_Avoid_: Machine (UI label only), server, remote (as a noun)

**Repository**:
A git clone on a host. A host artifact — not the same thing as a Project.
_Avoid_: Project (that is a desktop grouping), repo root

**Worktree**:
A git worktree of a Repository on a host.

**Workspace**:
A working directory on a host that emdash tracks — a repository, a worktree, or a plain directory. The place sessions and agents run in.

**Session**:
A running process (terminal or agent conversation) attached to a Workspace on a host. Host-owned; dies with its workspace.

### Desktop concepts

**Project**:
The desktop-side grouping that organizes tasks around a repository. An app concept only.
_Avoid_: Using "project" to mean the git repository on disk

**Task**:
A desktop-owned unit of agent work, linked to the Workspace it runs in.

**Registry**:
The desktop's index of tracked Workspaces. A record of what is tracked plus desktop annotations — never the authority on what exists on a host.
_Avoid_: Spec, expected state, source of truth (for host state)

### State vocabulary

**Host fact**:
State a host is authoritative for: existence of artifacts, git state, sessions. The desktop only caches it.

**Observation**:
A cached Host fact in the Registry, stamped with when it was last observed. Never authoritative; staleness is expected and displayed, not hidden.

**Provenance**:
The immutable record of what emdash asked for when it created a Workspace (stored as its config). Absent for adopted workspaces.
_Avoid_: Intent (nothing on the desktop expresses ongoing intent about host state)

**Adoption**:
Registering a Workspace that exists on a host but was not created by emdash. Automatic and unconfirmed for worktrees of a tracked Repository; repositories themselves are only ever tracked by explicit user action.

**Missing**:
A registered Workspace that a reachable host reports as gone. Rows with any desktop annotation (task link, provenance) stay visible until the user untracks them; never-annotated adopted rows are silently untracked — pure mirror entries follow the mirror.

**Tracked / Untracked**:
Whether a host artifact has a Registry entry. Untracking is a desktop decision about the Registry; deleting is a Host operation against the artifact.

### Operations

**Host operation**:
A durable, host-centric mutation of host state (remove a worktree, remove a repository). The host serializes and executes it; killing dependent sessions is part of the verb, not a separate desktop-ordered step.

**Desktop operation**:
A durable mutation of desktop-owned records (tasks, projects, links). Completes against desktop records immediately — it may enqueue Host operations into the Outbox, but never blocks on host availability.

**Outbox**:
The desktop's durable queue of Host operations awaiting their host (the kernel's host-gated operations). Survives restarts, drains on reconnect, and is cancelled when the host is forgotten.

**Plan preview**:
A desktop-compiled, non-authoritative prediction of how the host will expand a Host operation, shown for UI steps while offline. The host's actual expansion replaces it when execution starts.

**Removal pending**:
A registered Workspace whose removal has been enqueued but not yet confirmed gone by a host snapshot. Stays visible until confirmation or until its host is forgotten.
