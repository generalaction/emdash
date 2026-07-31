# Concepts

The mental model behind the operations kernel. Read this before the component
references — every component is a small application of the rules defined here.

## 1. Operations, resources, claims

Three nouns carry the whole system:

- An **operation** is a finite, durable unit of work with a typed input, a
  typed result or error, and a terminal state it always reaches — even across
  process restarts. "Tear down this workspace." "Prune this repo's stale
  worktree records." "Scan this worktree's git status."
- A **resource** is a named thing operations act on, arranged in an ownership
  hierarchy: host → repo → worktree → branch on the host side; project → task
  on the desktop side. Resources are identity + hierarchy, nothing more — the
  kernel never holds a resource "object", only its key.
- A **claim** is the relationship between the two: *this operation intends to
  read (or change) this resource*. Claims are plain data, frozen when the
  operation is admitted, and they drive every coordination decision the
  kernel makes.

Everything else — conflict policies, admission, dispatch, progress — is
machinery for answering questions about these three nouns.

## 2. The two planes

The app runs the kernel in two places with different roles:

- **The desktop ledger** is the *intent plane*. It is the durable,
  SQLite-backed record of everything the user (or automation) has asked for:
  a transactional outbox of pending host work plus the full history. Entity
  mutations and their operations commit in the same transaction — deleting a
  task and enqueueing the teardown of its workspace is one atomic write.
- **The host log** is the *execution plane*. Each host (the local machine, or
  a workspace server over SSH) keeps its own log of work it is actually
  performing against its own filesystem, git repos, and processes. It is the
  only place that knows physical truth.

Both planes run the **same kernel** — same claim modes, same matrix, same
admission function, same dispatch algorithm — over different
[`OperationStore`](./07-engine-and-stores.md#the-store-port) implementations.
This is the load-bearing property: the desktop and a host can never disagree
about whether two operations conflict, because the logic that decides is a
single shared pure function, not two implementations kept in sync by
discipline.

The planes connect at an app edge (not inside the kernel): a desktop
operation whose work lives on a host submits a corresponding host operation
and follows it. The desktop record is the durable intent ("this must
eventually happen, survive restarts, and be visible in history"); the host
record is the execution ("this is happening now, here are the stages").
Desktop-only operations (pure DB work) and host-initiated operations
(reconciler proposals) each live in one plane only.

## 3. Ownership taxonomy

Which plane owns an entity decides where its operations are admitted:

- **Desktop-owned**: projects, tasks, conversations, settings. Their truth is
  the desktop database; operations on them are admitted into the desktop
  ledger and often complete without any host involvement.
- **Host-owned**: worktrees, repos, branches, running processes. Their truth
  is the host's filesystem and process table; the desktop holds only
  *observed* snapshots of them (cached, timestamped, possibly stale).
  Operations on them are admitted into the desktop ledger as intent, then
  executed as host operations.

The corollary that shapes the whole design: **the desktop can never assume
its picture of host resources is current.** That is why claims are advisory
(§4) and why handlers re-check reality before acting.

## 4. Claims are advisory; handlers hold the guard

The kernel enforces claim compatibility at admission and dispatch — but a
claim is a reservation of *intent*, not a lock on the physical resource.
Nothing stops an external actor (the user in a terminal, another tool, a
crashed process leaving debris) from changing the resource underneath a
claim.

Safety therefore has two layers, following Chubby's advisory-locks-plus-
fencing design:

1. **Claims coordinate the actors the kernel can see.** Two kernel-managed
   operations will never concurrently mutate the same resource, and a
   subtree-wide operation will never interleave with descendant work.
2. **Handlers guard against everything else.** Every handler re-checks
   physical reality as its first act (does the path exist? is this still a
   worktree of that repo? is the branch merged?) and treats "reality
   disagrees with the input" as a first-class outcome (`rejected`), not an
   exception. Probing, idempotency markers, and recovery strategies are
   internal to handlers — deliberately invisible to the kernel, because they
   are per-operation engineering, not system semantics.

A claims bug therefore degrades to "the handler refused", never to data
loss.

## 5. The life of an operation

Every operation passes through the same four gates, each answering a
different question:

```text
submit ──► ADMISSION ──► [pending] ──► DISPATCH ──► [running] ──► EXECUTION ──► terminal
              │                            │                          │
              │ may this intent exist      │ may this run *now*?      │ what actually
              │ in the log at all?         │ (matrix vs running set)  │ happened?
              │ (matrix + policy verbs     │ defers, never errors     │ (handler + physical
              │  vs non-terminal set)      │                          │  guard + retries)
              ▼                            ▼                          ▼
   dedupe / reject / supersede      waits holding nothing      succeeded / failed /
   / queue / insert                 (no hold-and-wait)         rejected / cancelled
```

- **Admission** ([04](./04-admission-and-conflicts.md)) runs inside the log
  owner's transaction, checks the incoming operation's claims against every
  *non-terminal* record using the compatibility matrix, and resolves
  collisions with a policy verb: `dedupe` (same work already queued — return
  the existing handle), `reject` (refuse), `supersede` (the newcomer replaces
  the incumbent), or `queue` (both may exist; dispatch will order them).
- **Dispatch** ([05](./05-dispatch.md)) decides *when* a pending operation
  starts: its claims must be matrix-compatible with the claims of everything
  currently *running*. A waiting operation holds durable claims but zero
  runtime resources — it acquires its whole claim set atomically at start or
  not at all, so deadlock is structurally impossible (no hold-and-wait).
- **Execution** ([06](./06-execution-and-handlers.md)) runs the handler with
  cancellation, retries with backoff, and stage-level progress reporting.
- **Settlement** writes the terminal status plus a compact outcome summary
  to the record, releases the claims, and pokes dispatch.

Two invariants hold throughout:

- **Claims are frozen at admission.** They are computed once from
  `definition.claims(input)`, stored on the record, and read verbatim by
  dispatch and the UI. Nothing re-derives them later.
- **Status only moves forward.** The status set and its legal transitions are
  a closed machine ([03](./03-operations.md#statuses)); every store write is
  a compare-and-swap on the expected current status.

## 6. Live progress vs durable outcome

The kernel splits "what is this operation doing" from "what did it do",
because they have different lifetimes and different consumers:

- **Progress is live and ephemeral.** While running, a handler's stages
  stream through a `ProgressSink` as
  [`OperationProgress`](./06-execution-and-handlers.md#stages-and-progress)
  values, keyed by operation id. The app edges publish these over wire live
  state; the renderer's checklists and status pills read them. When the
  operation settles, the stream ends. Nothing is persisted per stage-tick.
- **Outcome is durable and compact.** The record keeps a terminal summary —
  which stage failed, which completed, and optional structured facts — enough
  for history views, error surfaces, and retry decisions, without turning the
  operations table into a time-series store.

## 7. Operations vs sessions

Not everything programmatic is an operation. The test is *shape of
termination*:

- Work with a natural terminal state — provision, teardown, prune, scan,
  measure, delete — is an **operation**. It benefits from admission, claims,
  retries, and history.
- Work that runs until told to stop — an agent session, a terminal, a dev
  server — is a **supervised process**. Forcing it into operation shape
  produces a permanently-`running` row that pollutes every non-terminal
  query. Instead, its *birth* is a small operation ("spawn agent" — validate,
  claim, start, record) that hands off to the process supervisor, and the
  running process holds a **usage hold** on its resources, not a claim.

Relatedly, the kernel models exactly one relation kind — claims (exclusive
or shared *intent by operations*, durable). Usage holds (liveness of running
consumers) and references (structural edges in the database) are distinct
relations owned elsewhere; conflating them was one of the failure modes the
kernel exists to avoid.

## 8. Purity as the architecture

The kernel's internal rule: **decisions are pure functions; effects live at
the edges.** `modesCompatible`, claim expansion, `admit`, `dispatchPass`,
and status transitions are all pure over plain data. The engine
([07](./07-engine-and-stores.md)) is the only component that sequences
effects — store transactions, handler invocation, clock, progress
publication — and it does so through ports (`OperationStore`,
`ProgressSink`, `Clock`) so the whole lifecycle runs in a unit test against
an in-memory store with a fake clock.

This is the same discipline as `wire/src/state/` (pure graph, effects only
at observation edges) and it is what makes the two-plane guarantee of §2
real: sharing pure functions is trivial; sharing effectful services across a
desktop app and a remote server is not.
