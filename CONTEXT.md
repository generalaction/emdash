# Emdash

Emdash runs AI coding agents in parallel across isolated git worktrees on local and remote machines. The desktop app coordinates; workspace hosts execute.

## Language

### The model

**Inventory-and-command model**:
Emdash's state model for host artifacts: the host's inventory is authoritative — for Workspaces indexed by the Host registry — the desktop Registry converges toward it, and there is no standing desired state: emdash never re-converges the world toward a record. Mutations are plain fail-fast wire RPCs (ADR 0005), with one deliberate exception: deletion intent survives unreachability as a Tombstone, swept by the Reconcile sweep (ADR 0006). Creation never converges; only tombstoned deletions do. See ADR 0001 for the authority stance.
_Avoid_: Spec/status, desired state, converging the world toward a record (the one convergence loop removes tombstoned artifacts, nothing else)

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

**Plugins**:
One word, three homes — say which one you mean: the capability framework (`@emdash/shared/plugins`), the concrete agent providers (`@emdash/plugins`), and the host services that install and run them (`packages/core/src/services/agent-plugins`).
_Avoid_: Unqualified "plugins" where the home matters

### Desktop concepts

**Project**:
The desktop-side grouping that organizes tasks around a repository. An app concept only.
_Avoid_: Using "project" to mean the git repository on disk

**Project context**:
The desktop-owned live context of a registered Project: the shell and desktop facts that remain
available regardless of Host reachability. Failure to reach or inspect the Host never makes the
Project context unavailable.
_Avoid_: Project mount (conflates desktop availability with Host attachment)

**Project context error**:
A typed failure to construct a Project context from durable desktop data. Limited to an invalid
Project record or failed desktop context hydration; it is the only Project failure class that may
replace the normal shell.
_Avoid_: Classifying Host, attachment, or Repository access failures as Project context errors

**Host attachment**:
The per-Project runtime link to its Host, independent of the Project context. An established
attachment survives an ordinary Host disconnect; Host-dependent capabilities report the temporary
loss and resume when transport reconnects.
_Avoid_: Treating SSH connection state as Project availability

**Task**:
A desktop-owned unit of agent work, linked to the Workspace it runs in.

**Command palette**:
The desktop's unified search surface for actions, tasks, projects, conversations, and files. Empty-query suggested actions are a curated idle list, not the catalog.
_Avoid_: CMDK (the library), treating idle as the full command catalog

**Keyword mode**:
A command-palette query restricted to one kind by an `@kind` prefix (`@files`, `@commands`, `@tasks`, `@conversations`, `@projects`).
_Avoid_: Scoped search (Scope is the ownership primitive), treating `@` as a sixth provider

**Host (services/hosts)**:
`src/core/services/hosts` owns machine lifecycle and workspace-server provisioning under the Host vocabulary (`HostService`, the `hosts` wire domain) — the merged home of the former `remote-machine` and `workspace-server` services. "Machine" remains a UI label only. Host (wire) remains the separately-scoped wire term.
_Avoid_: Machine (outside UI labels), "remote" as a noun

**Desktop Secret Authority**:
The desktop-owned authority over user Secret references, storage backends, Host grants,
rotation and revocation, and the aggregate audit history. Desktop-only consumers resolve
through it directly; Host-executed consumers reach it through the Host Secret Runtime.
_Avoid_: Treating the desktop store as the process-injection layer, separate local and
remote secret authorities

**Host Secret Runtime**:
The Host-owned capability that authorizes and delivers granted Secrets to Git, agents,
scripts, and configuration materialization on that Host. The same capability serves the
local Host and SSH-connected Hosts; locality changes transport and offline availability,
not ownership or the consumer path.
_Avoid_: Remote secrets service, calling desktop secret storage directly from Host-executed
consumers

**Host registry**:
A host's durable, sole-writer index of its Workspaces: registered paths plus host-computed Observations, pushed to desktops as one live model that merges the durable records with the Runtime overlay. The filesystem stays authoritative — the registry observes it (adopting and un-adopting worktrees), never converges it toward a record. See ADR 0005.
_Avoid_: Source of truth (the filesystem is), desired state

**Registry**:
The desktop's mirror of each Host registry plus desktop annotations (task links, Provenance, client config) — never the authority on what exists on a host.
_Avoid_: Spec, expected state, source of truth (for host state)

**Mirror kernel**:
The lean shared machinery behind the per-kind Registries: the per-host sync attachment service, the `sweepUnseen` helper (grace window + the missing/untrack split), guard fragments, and the contract test suite every kind's registry must pass. Claim/Observe upserts and snapshot-apply functions stay hand-written per kind — the suite, not shared code, is what keeps the two stacks from drifting. It converges the mirror toward host Observations and is never an authority.
_Avoid_: Sync kernel (that is the client↔client CRDT plane), Registry kernel (invites confusion with the Host registry, which is the authority the kernel is not), verb-building framework (deliberately rejected for exactly two kinds)

**Host records kit**:
The lean helper set in `packages/core` that sole-writer host runtimes compose in — the records publication helper (cell + expose + publish, guaranteeing the snapshot-on-subscribe `records` semantics the Mirror kernel's sync attachment assumes) and the idempotent-delete helper. Deliberately not a framework: runtimes stay hand-written, and the idempotent-create replay rule is a stated contract with per-kind implementations.
_Avoid_: Host kernel (there is no host-side counterpart to the Mirror kernel), runtime scaffold/base class

**Session lifecycle chassis**:
The one deep module behind the session-shaped runtimes' lifecycle glue — activity tracking, idle sweeping, intent persistence, reporter fan-out, and eviction — replacing the per-runtime copies. Keyed by Session, so it serves terminals as well as agents; Conversation concerns (intents, reporter, reconcile) are one optional block that a subset consumer omits. Eviction runs a named per-key resource list and always reports the session's end, so teardown and reporting cannot drift.
_Avoid_: Conversation lifecycle (terminals carry no Conversation), framework/base-class framing (runtimes stay hand-written and drive it)

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
Whether a host artifact has a Registry entry. Untracking is a desktop decision about the Registry; deleting is a host verb against the artifact.

**Identity lost**:
A Registry row whose Host can no longer be decoded — a remote row whose SSH connection was deleted, or a row with no location. Never reinterpreted as local: host-mutating flows refuse, a Project whose Repository row is identity-lost is skipped like a missing one, reads surface the loss rather than guess.
_Avoid_: Falling back to local, empty connection ids

### Operations

**Workspace verb**:
One of the six plain RPCs on the Host registry contract: createWorkspace, createWorktree, activateWorkspace, deactivateWorkspace, deleteWorkspace, deleteWorktree. Fail fast when the host is unreachable — nothing is queued. Handlers serialize with a keyed mutex (per-repo exclusive for worktree create/delete, per-workspace for activate/deactivate/delete; waits, not errors); killing dependent sessions is part of deactivate, which the delete verbs compose server-side. Deletes are idempotent and identity-keyed (a different record id at the path no-ops); deleteWorktree is the only artifact-destroying verb.
_Avoid_: Host operation, enqueue/queue language, claims, preflight RPCs (informed confirmation reads the mirror)

**Desktop operation**:
A mutation of desktop-owned records (tasks, projects, links). Completes against desktop records immediately and never blocks on host availability — the host-artifact halves of a cascade become Tombstones for the Reconcile sweep.

**Tombstone**:
A durable mark on a mirror row recording that the user deleted the entity: the deletion intent itself, carrying the frozen deletion options and the target record's id. Visible as the pending state until the Reconcile sweep converges it (or the user chooses Untrack anyway); purged when the mirror confirms the host record gone, and by forget-host. Tombstones have no expiry — boundedness comes from visibility and the terminal-failure stop.
_Avoid_: Queue/outbox language, "removal pending" as a separate state (the visible tombstoned row is the pending state), expiring intent

**Reconcile sweep**:
The client-side loop that converges tombstoned entities: whenever a host is reachable (boot, reconnect, tombstoned-while-online, 10-minute backstop), it calls each kind's idempotent removal verb for that host's tombstones and purges on mirror-confirmed absence. Entity-generic — one sweep, per-kind removal functions; failure classes are host-written on the record (transient retries silently, terminal stops with Retry / Untrack anyway). Deletion-only: it removes what tombstones name and converges nothing else.
_Avoid_: Reconciling the host toward records generally (ADR 0001 still rejects that), cross-kind ordering guarantees, treating RPC returns as truth (the record's outcome metadata is)

**Scan**:
The host-side pass that computes Observations and performs Adoption for registered paths — it reads the filesystem and git, records what it finds in the Host registry, and never mutates the world or converges it toward a record (ADR 0001). A failed or partial scan writes nothing (the positive-assertion invariant). Owned by the Registry scanner inside the workspace-registry runtime.
_Avoid_: Reconcile (the Reconcile sweep is the client-side, deletion-only tombstone loop), sync (that is the mirror plane)

**Placement**:
The desktop policy that picks the intended path for a new Workspace — computed from settings and Registry knowledge only, never by probing the host. The host is the final arbiter of what actually happens at that path.
_Avoid_: Probing, path reservation (nothing holds a path on the host)

**Claim**:
Registration atomically taking ownership of an already-mirrored live row in one statement: origin becomes registered, the caller's annotations are written, observations refresh. A Claim is never optimistic — a mirror row exists only for a host-acknowledged record, so pre-ack "creating" state is ephemeral memory, never a row. Colliding with an untracked row refuses — a Claim never revives a Tombstone.
_Avoid_: Upsert (the mechanism, not the meaning), creation reviving tombstones, mirror-first creation (the Registry mirrors acked records; it never front-runs the Host registry)

**Observe**:
A snapshot delivery's sole write verb: insert-as-adopted for an unknown id, or refresh observation columns only — never annotations, never origin, never an untracked row. The never-resurrect guard is structural, not a separate check.
_Avoid_: Adopt-or-refresh branching (Observe is one statement), deliveries resurrecting untracked rows

**Activation**:
The moment a Workspace accepts Sessions. Session start waits for the prepare script to finish, but activation is never blocked by a script failure — failures surface as Workspace notices. Setup runs after activation, concurrent with live sessions; run scripts wait on setup success. Activation is ephemeral host-runtime state living in the Runtime overlay: after a daemon restart every workspace is inactive, and only lastActivatedAt persists as an Observation. Deactivation (kill all sessions + time-boxed, non-fatal teardown) is owned by deactivateWorkspace alone.
_Avoid_: Provisioning (that creates the artifact; activation starts using it), durable "active" flags

**Workspace notice**:
A surfaced, non-fatal event about a Workspace's session plane (a failed prepare or setup script). Informational with a re-run affordance, carried on the workspace's Runtime overlay — ephemeral like the activation it belongs to. The durable trace is the per-script last-outcome on the workspace record, which survives daemon restarts and syncs to the mirror.
_Avoid_: Operation, error state (the workspace keeps working)

### File identity vocabulary

Roles in `@emdash/core/primitives/path/api` (see `agents/architecture/path-system.md`), adopted as
the file identity for the unified content stack.

**HostFileRef**:
The canonical identity of a file: a Host (`HostRef`) plus an absolute path on that host. Independent
of any Workspace — workspace membership is a view/scoping concern, never part of file identity.
_Avoid_: HostPathRef (retired working name), (workspaceId, relative path) as identity

**ResourceUri**:
The serialized form of a HostFileRef (`emdash-file://v2/...`), used on the wire and in durable
state.
_Avoid_: Raw absolute path strings as serialized identity

**ResourceKey**:
The normalized comparison key derived from a HostFileRef for in-memory maps and dedupe — accounts
for case sensitivity and unicode normalization without changing display spelling.
_Avoid_: Using formatted paths or ResourceUris as map keys where normalized equality matters

**ScopedPath**:
A root HostFileRef plus a portable relative path — the shape for root-relative operations (tree
entries, watcher events, git paths, bulk calls). Not a file identity: the same file reached via
different roots yields different ScopedPaths.
_Avoid_: Keying content or open-file state by ScopedPath

**Facet**:
One of the up-to-three Monaco models of a single open file: the writable buffer, the read-only disk
mirror, and a read-only git snapshot at a ref. Facet URIs derive deterministically from the file's
ResourceUri and decode back to its HostFileRef.
_Avoid_: Treating facets as independent files with unrelated URIs

### Wire vocabulary

Roles in `packages/wire`, settled by the wire-architecture map's naming pass.

**Source**:
The server-side owner of one endpoint instance's data — the thing followers sync from. Named with a `Source` suffix (`LiveLogSource`, `LiveJobSource`, `EventStreamSource`); these implement the protocol `LiveSource` seam.
_Avoid_: Server (a file-name word, not a role), host (that is the keyed registry)

**Host (wire)**:
A keyed server-side registry of Sources serving one endpoint (the event-stream host), or the worker process registry (`WireWorkerHost`). Never a single instance's owner.
_Avoid_: Using host for a single Source

**Follower**:
The client-side sync state machine (`LiveFollower`): generation/sequence tracking, gap detection, resync. Internal machinery under every replica.

**Replica**:
One client-side, follower-backed copy of a Source's data: `ReplicaState`, `ReplicaLog`, `ReplicaJob`.
_Avoid_: Client (that is the RPC-side word)

**Replica cache**:
The keyed, refcounted, lingering cache of Replicas (`*ReplicaCache`), built on the kernel's keyed-retention primitive. Acquire/release leases; linger starts at last release.
_Avoid_: Word-order distinctions (the old `LiveJobReplica`-vs-`ReplicaJob` convention)

**State kernel**:
Wire's reactive state primitives (`cell`, `derived`, `family`, `query`, `optimistic`) — the only public surface for state-shaped data. Retention is observation-driven: observed ⇒ retained; `retain()` is the keep-warm exception.
_Avoid_: Authoring state models with hand-written providers (use `cell` + `expose`), consuming them with anything but `remote()`

**Bridge**:
The adapter pair carrying kernel state over the live-model wire protocol: `expose` (server) and `remote` (client). An adapter over the live layer, not a parallel transport.

**Wire seam**:
The seeded-connection seam in `primitives/wire/browser` — the single point where a host process hands core its wire connection. The host bootstrap calls `seedWireConnection` once; everything else reaches the wire through `domainClient`.
_Avoid_: Acquiring a connection anywhere else in core, reaching the wire through renderer-owned clients (the aggregate desktop wire client is renderer-internal)

### Core vocabulary

Roles in `packages/core`, sharpened during the exec-and-layering effort.

**Runtime (core)**:
Host-specific code under `packages/core/src/runtimes/` — a wire component worker that runs on the host plane, both locally and in the workspace-server, serving desktops through the host runtimes contract. Being a subprocess over wire is not sufficient: a worker that serves other workers rather than desktops (fs-watch) is a service, not a runtime.
_Avoid_: Calling every wire component worker a runtime

### Shared vocabulary

Roles in `packages/shared`, settled by the shared-architecture naming pass.

**Prelude**:
The root entrypoint (`@emdash/shared`) — the single home for the blessed cross-cutting core: the result module, `Unsubscribe`, `Emitter`, the lifecycle leases, `isDeepEqual`, the serialization/error family, and `Secret`. One home per symbol package-wide: domain modules stay subpath-only, and nothing is importable from both the root and a subpath.
_Avoid_: Re-exporting a prelude symbol from a subpath, aliasing a shared type under a domain name

**Scope**:
The ownership primitive: cancellation, cleanup ordering, child ownership, and tracked async work that must not outlive its feature. Registries, caches, and runs hang off a Scope rather than inventing their own teardown.
_Avoid_: Hand-rolled dispose lists, work that outlives its owner

**Clock**:
The time seam. No raw `Date.now`/`setTimeout` outside `scheduling/clock.ts`; anything time-dependent (`async-cache`, `resource-cache`, retry, timeouts) takes a `Clock` so tests drive time with `createManualClock`.
_Avoid_: Direct timer calls in primitives, fake-timer test hacks where a `Clock` parameter exists

**RetrySchedule**:
The one retry/backoff word. The `retrySchedule(options)` constructor lives beside the `retrySchedules` combinator namespace in `@emdash/shared/scheduling`; a schedule maps a retry index to a delay or `undefined` (stop).
_Avoid_: Backoff/BackoffSchedule (dissolved), per-package retry vocabularies

**Secret**:
The wrapper for secret-adjacent values (`secret`, `isSecret`, `reveal`, `REDACTED`), exported from the prelude. Values stay wrapped through internal plumbing and logging (the logger replaces them with `[REDACTED]`); `reveal` only at true boundaries — the process env of a spawn, an HTTP header, OS keychain writes.
_Avoid_: Revealing early and passing plaintext through layers, logging revealed values

**Package conventions**:
Ownership-drop: a primitive that takes ownership of a value fires `onDrop` exactly once for every taken-then-discarded value, and rejecting a value never fires it (the caller kept ownership). Never-silent: optional failure hooks default to logger-backed reporting rather than swallowing.
_Avoid_: Silent drops, failure hooks whose omission loses the error
