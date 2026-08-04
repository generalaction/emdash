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
A running process (terminal or agent process) attached to a Workspace on a host. Host-owned; dies with its workspace.
_Avoid_: Conversation (that is the durable record a session carries forward)

**Conversation**:
A durable record of an agent exchange, attached to a Workspace. One Conversation outlives its Sessions — the successive live processes that carry it; resuming starts a new Session of the same Conversation. Identified by its own id for its whole life; any provider session handle it holds is a last-observed pointer, not its identity.
_Avoid_: Session (a conversation is not a process), using the provider's session id as the conversation's identity

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

**Register**:
Creating a Registry entry for a Workspace emdash itself created, carrying its Provenance. Distinct from Adoption, which records artifacts emdash did not create and carries none.

**Purge**:
Hard-deleting already-untracked Registry rows as retention cleanup. Never valid on tracked rows — untracking is the only way a tracked row leaves the Registry.

**Missing**:
A registered Workspace that a reachable host reports as gone. Rows with any desktop annotation (task link, provenance) stay visible until the user untracks them; never-annotated adopted rows are silently untracked — pure mirror entries follow the mirror.

**Tracked / Untracked**:
Whether a host artifact has a Registry entry. Untracking is a desktop decision about the Registry; deleting is a Host operation against the artifact.

**Identity lost**:
A Registry row whose Host can no longer be decoded — a remote row whose SSH connection was deleted, or a row with no location. Never reinterpreted as local: host-mutating flows refuse, a Project whose Repository row is identity-lost is skipped like a missing one, reads surface the loss rather than guess.
_Avoid_: Falling back to local, empty connection ids

### Operations

**Host operation**:
A durable, host-centric mutation of host state (remove a worktree, remove a repository). The host serializes and executes it; killing dependent sessions is part of the verb, not a separate desktop-ordered step.

**Desktop operation**:
A durable mutation of desktop-owned records (tasks, projects, links). Completes against desktop records immediately — it may enqueue Host operations into the Outbox, but never blocks on host availability.

**Outbox**:
The desktop's durable queue of Host operations awaiting their host (the kernel's host-gated operations). Survives restarts, drains on reconnect, and is cancelled when the host is forgotten.

**Host claim**:
An exclusive claim on a Host's kernel resource — the designated admission guard for host-level verbs. Artifact operations propagate intent claims to their Host, so an exclusive host claim conflicts with all in-flight work on that host. Claims guard admission only: the Outbox still cancels when the host is forgotten, and referential checks ("does anything still point here") stay data checks.
_Avoid_: Using claims to block forgetting, ad-hoc per-verb host guards

**Plan preview**:
A desktop-compiled, non-authoritative prediction of how the host will expand a Host operation, shown for UI steps while offline. The host's actual expansion replaces it when execution starts.

**Removal pending**:
A registered Workspace whose removal has been enqueued but not yet confirmed gone by a host snapshot. Stays visible until confirmation or until its host is forgotten.

**Placement**:
The desktop policy that picks the intended path for a new Workspace — computed from settings and Registry knowledge only, never by probing the host. The host is the final arbiter of what actually happens at that path.
_Avoid_: Probing, path reservation (nothing holds a path on the host)

**Activation**:
The moment a Workspace accepts Sessions. Session start waits for the prepare script to finish, but activation is never blocked by a script failure — failures surface as Workspace notices. Setup runs after activation, concurrent with live sessions; run scripts wait on setup success.
_Avoid_: Provisioning (that creates the artifact; activation starts using it)

**Workspace notice**:
A surfaced, non-fatal event about a Workspace's session plane (a failed prepare or setup script). Informational with a re-run affordance — never an operation-log entry, because it mutates no inventory and holds no claims.
_Avoid_: Operation, error state (the workspace keeps working)
