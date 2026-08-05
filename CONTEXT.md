# Emdash

Emdash runs AI coding agents in parallel across isolated git worktrees on local and remote machines. The desktop app coordinates; workspace hosts execute.

## Language

### The model

**Inventory-and-command model**:
Emdash's state model for host artifacts: the host's inventory is authoritative — for Workspaces indexed by the Host registry — the desktop Registry converges toward it, and there is no standing desired state: emdash never re-converges the world toward a record. Workspace mutations are plain fail-fast wire RPCs, not durable commands (ADR 0005). See ADR 0001 for the authority stance.
_Avoid_: Spec/status, desired state, reconciling the host (the record reconciles, the host does not)
_In transition (2026-08-05)_: conversations deletion still runs through the Outbox until the operation-log-retirement effort replaces it with tombstone-and-reconcile.

### Places and artifacts

**Host**:
A machine emdash can reach and run commands on — the local machine or an SSH-connected remote. Authoritative for everything that physically exists on it.
_Avoid_: Machine (UI label only), server, remote (as a noun)

**Host diagnostics**:
Read-only health facts about a Host: resource metrics and system-dependency detection/install status. Scoped to the Host, not to machine connections — the local host has diagnostics too (the System settings tab). Owned by the `host-diagnostics` slice; the machine details view embeds it.
_Avoid_: Machine metrics (diagnostics are not connection-specific), system (too generic)

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

**Host registry**:
A host's durable, sole-writer index of its Workspaces: registered paths plus host-computed Observations, pushed to desktops as one live model that merges the durable records with the Runtime overlay. The filesystem stays authoritative — the registry observes it (adopting and un-adopting worktrees), never converges it toward a record. See ADR 0005.
_Avoid_: Source of truth (the filesystem is), desired state

**Registry**:
The desktop's mirror of each Host registry plus desktop annotations (task links, Provenance, client config) — never the authority on what exists on a host.
_Avoid_: Spec, expected state, source of truth (for host state)

### State vocabulary

**Host fact**:
State a host is authoritative for: existence of artifacts, git state, sessions. The desktop only caches it.

**Observation**:
A Host fact computed on the host, held in its Host registry, and mirrored into the Registry — stamped with when it was last observed. Never authoritative; staleness is expected and displayed, not hidden. Changed-line stats count untracked files' lines as additions.

**Runtime overlay**:
The in-memory, per-Workspace host state merged into the Host registry's live model: creation progress, Activation phase and script states, Workspace notices. Ephemeral by design — absent after a daemon restart. The only progress surface for workspace verbs; there are no job objects.
_Avoid_: Persisting "active" as a durable flag (lastActivatedAt is an Observation)

**Provenance**:
The immutable record of what emdash asked for when it created a Workspace (stored as its config). Absent for adopted workspaces.
_Avoid_: Intent (nothing on the desktop expresses ongoing intent about host state)

**Adoption**:
The Host registry recording a Workspace that exists on disk but was not registered through a verb. Automatic and unconfirmed for worktrees of a registered Repository, performed by the host's own scan; adopted records follow the disk (deleted when the artifact vanishes). Repositories and plain directories are only ever tracked by explicit action.

**Register**:
Creating a Host registry record for a path through a create verb, under a desktop-minted id. Registered records survive a vanished path as Missing. Provenance stays a desktop annotation on the mirror row; the host record keeps only the minimal immutable creation fields replay is enforced against.

**Purge**:
Hard-deleting already-untracked Registry rows as retention cleanup. Never valid on tracked rows — untracking is the only way a tracked row leaves the Registry.

**Missing**:
A registered Workspace whose path a reachable host reports as gone. The Host registry keeps the record (observedStatus missing) until a delete verb removes it; adopted records are instead deleted outright — pure mirror entries follow the disk.

**Tracked / Untracked**:
Whether a host artifact has a Registry entry. Untracking is a desktop decision about the Registry; deleting is a Host operation against the artifact.

**Identity lost**:
A Registry row whose Host can no longer be decoded — a remote row whose SSH connection was deleted, or a row with no location. Never reinterpreted as local: host-mutating flows refuse, a Project whose Repository row is identity-lost is skipped like a missing one, reads surface the loss rather than guess.
_Avoid_: Falling back to local, empty connection ids

### Operations

**Workspace verb**:
One of the six plain RPCs on the Host registry contract: createWorkspace, createWorktree, activateWorkspace, deactivateWorkspace, deleteWorkspace, deleteWorktree. Fail fast when the host is unreachable — nothing is queued. Handlers serialize with kernel claims; killing dependent sessions is part of deactivate, which the delete verbs compose server-side. Deletes are idempotent; deleteWorktree is the only artifact-destroying verb.
_Avoid_: Host operation (for workspaces), enqueue/queue language, preflight RPCs (informed confirmation reads the mirror)

**Host operation**:
A durable, host-centric mutation of host state, executed through the Outbox. Since ADR 0005 this is legacy vocabulary — Workspaces use Workspace verbs; conversations deletion is the remaining durable-command user until the operation-log-retirement effort lands.

**Desktop operation**:
A durable mutation of desktop-owned records (tasks, projects, links). Completes against desktop records immediately — it may enqueue Host operations into the Outbox, but never blocks on host availability.

**Outbox**:
The desktop's durable queue of Host operations awaiting their host (the kernel's host-gated operations). Survives restarts, drains on reconnect, and is cancelled when the host is forgotten. Workspace verbs never use it (ADR 0005).
_In transition (2026-08-05)_: being retired for its remaining users in favor of tombstone-and-reconcile (operation-log-retirement effort); the tombstoned registry row becomes the durable intent.

**Host claim**:
An exclusive claim on a Host's kernel resource — the designated admission guard for host-level verbs. Artifact operations propagate intent claims to their Host, so an exclusive host claim conflicts with all in-flight work on that host. Claims guard admission only: the Outbox still cancels when the host is forgotten, and referential checks ("does anything still point here") stay data checks.
_Avoid_: Using claims to block forgetting, ad-hoc per-verb host guards

**Plan preview**:
A desktop-compiled, non-authoritative prediction of how the host will expand a Host operation, shown for UI steps while offline. The host's actual expansion replaces it when execution starts.

**Removal pending**:
_Retired for workspaces (2026-08-05, ADR 0005)_: Workspace verbs fail fast instead of enqueueing, so no workspace removal is ever pending. The notion survives only where the Outbox does (conversations deletion) until that effort retires it too.

**Placement**:
The desktop policy that picks the intended path for a new Workspace — computed from settings and Registry knowledge only, never by probing the host. The host is the final arbiter of what actually happens at that path.
_Avoid_: Probing, path reservation (nothing holds a path on the host)

**Activation**:
The moment a Workspace accepts Sessions. Session start waits for the prepare script to finish, but activation is never blocked by a script failure — failures surface as Workspace notices. Setup runs after activation, concurrent with live sessions; run scripts wait on setup success. Activation is ephemeral host-runtime state living in the Runtime overlay: after a daemon restart every workspace is inactive, and only lastActivatedAt persists as an Observation. Deactivation (kill all sessions + time-boxed, non-fatal teardown) is owned by deactivateWorkspace alone.
_Avoid_: Provisioning (that creates the artifact; activation starts using it), durable "active" flags

**Workspace notice**:
A surfaced, non-fatal event about a Workspace's session plane (a failed prepare or setup script). Informational with a re-run affordance, carried on the workspace's Runtime overlay — ephemeral like the activation it belongs to, never an operation-log entry, because it mutates no inventory and holds no claims.
_Avoid_: Operation, error state (the workspace keeps working)
