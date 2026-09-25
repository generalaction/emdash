# One supervisor owns each Host connection

Status: accepted and implemented. Automated fault-injection coverage runs against the production
supervisor and adapters. Real-machine sleep/VPN validation remains a manual release check.

## Problem

A retained SSH client, a pinned Wire client, and a previous Host handshake describe
different facts. After sleep or a silent network interruption, all three can remain
present while requests no longer reach the workspace server. Browser recovery wakeups
currently trust cached Host readiness. Request deadlines expire individual calls without
invalidating the transport. Ordinary reconnects intentionally preserve attachments, but
that preservation also allows stale positive availability to survive.

There is a second readiness gap: acquiring an existing pinned Wire client does not await
its current transport handshake. Invalidating Host availability alone can therefore
publish ready again before recovery completes.

## Decision and ownership

The `Hosts` registry owns one `HostService` per remote Host identity. Each service exposes
`connection`, `runtime`, and `server`, and owns its provisioning caches and operation queue.
`server` exposes `HostWorkspaceServer`, implemented by one `RemoteHostWorkspaceServer` bound
to the Host identity. It owns daemon state observation and serialized maintenance operations;
callers do not supply connection IDs to individual methods.
The registry owns lookup, identity replacement, aggregate state/events, and lease rebinding.
Its `lease(connectionId, owner)` follows identity replacements until the owner is disposed.
Per-instance `host.connection.lease(owner)` remains bound to that instance's identity.
Retained services are invalid after identity replacement; their late work cannot publish into the
replacement's state. Local workers remain on the desktop bootstrap path.

Each Host service composes one `ManagedHostConnection`. It owns leases,
runtime pins, and persisted intent, and composes one connection supervisor. That supervisor is
the sole authority for connection execution, liveness evidence, recovery sequencing,
retry scheduling, and observable Host availability. Both live under
`apps/emdash-desktop/src/core/services/hosts/node/`, using existing Scope, cancellation,
clock, scheduling, and typed Result primitives.

The supervisor operates bounded adapters:

- SSH resolves credentials/configuration, establishes physical clients, opens channels,
  performs operations, and cleans up resources. It does not independently retry a Host.
- Workspace-server provisioning performs explicit preparation operations. Its daemon
  installation/start/update responsibilities remain separate from transport health.
- Wire handles protocol requests and subscription reattachment. A controlled replaceable
  transport supports detach, installation of an initialized candidate, and final disposal.
  The remote Host path does not use an autonomous Wire reconnect loop.
  The supervisor composes `HostRuntimeConnection` to own this stable Wire identity and perform
  bounded open/initialize/install and generation-bound health checks. The module disposes failed
  or late candidates; it does not own intent, provisioning, retry scheduling, or Host availability.
- Electron bootstrap feeds suspend/resume hints to the supervisor. Browser focus/online
  hints arrive over typed Wire. Neither surface decides whether the Host is healthy.
- Persistence remains responsible for machine configuration and `shouldConnect`; the
  managed connection serializes intent reads/writes and feeds the resulting policy to its supervisor.

The generic reconnecting Wire transport may remain for unrelated callers. This decision
does not introduce a general actor framework or move Electron dependencies into Core.

## Intent, demand, identity, and evidence

Explicit Connect maintains the machine connection until Disconnect, including when no
Project is open. Startup restores persisted connection intent. Scope-owned demand governs
runtime attachment work; observation alone does not establish a connection or alter blocked policy.
Explicit runtime intent is independent of automatic demand leases. Readiness waits observe work
owned by that intent or an automatic lease; they do not acquire implicit, unowned demand.
The public API expresses these as `pin()` and `lease(owner)`. Projects own a child-scope lease
while automatic access is eligible and dispose it when access becomes ineligible. Observation
owns no lease; the automatic/passive demand-mode API has been removed.
Restored SSH permission does not create a runtime pin.
SSH-only consumers can request SSH access without a successful workspace-server handshake. Every consumer,
including bootstrap restoration, host attachment participants, and port forwards, enters
through the supervisor instead of starting a second recovery owner.

Disconnect immediately suppresses recovery and cancels attempts, probes, and retry timers.
It persists disconnected intent through the existing storage authority; persistence errors
must be surfaced rather than reporting durable success. Background demand and wakeups never
reverse an explicit Disconnect. Application shutdown also cancels work, without changing
persisted user intent.

A logical runtime attachment owns stable client/subscription identity across ordinary
outages. Its existence makes no readiness claim. Separate physical SSH and Wire generations
fence callbacks, health results, teardown events, and late candidates. Initialize records the
daemon identity; a new daemon requires session/state reconciliation even if protocol-compatible.
Host readiness generations are not SSH generations, Wire generations, or Session generations.

A destination/identity change invalidates the old attachment and its observations; a different
machine must not inherit cached facts simply because the desktop configuration id is reused.

## State and interface

The internal supervisor state has the following meanings. Host availability is its projection,
not another mutable state machine with its own successful-result cache and retries. Private kernel
cells hold connection state; derived read-only availability follows the current supervisor through
a stable per-Host source reference, so retired identities cannot publish into their replacement.
The public `HostConnection` port exposes `availability`, `lease(owner)`, `pin()`, and `disconnect()`, without
exposing mutable state, transport control, or the concrete supervisor.
Pin and Disconnect return typed intent/persistence Results independently of network outcomes.
Readiness waits and wake controls belong to separate internal integration ports.

| State | Meaning |
| --- | --- |
| `idle` | No runtime attachment is being maintained; SSH-only intent may remain active |
| `connecting` | SSH establishment, server preparation, or Wire initialization |
| `ready` | The current initialized attachment has fresh responsiveness evidence |
| `checking` | Previous evidence is uncertain and validation is in progress |
| `recovering` | A failed layer is being replaced or a retry is scheduled |
| `blocked` | A typed issue requires user/configuration action; the failed layer is recorded |
| `paused` | An explicit server operation is running, the server was stopped, or an operation failed |
| `stopped` | Explicit user Disconnect suppresses connection work |

Connection/recovery states carry phase, cause, attempt, and optional next-attempt time.
Layer diagnostics can report SSH availability independently of runtime availability.
An SSH-only connection does not imply that the Host runtime is ready.

The supervisor interface separates operations with different semantics:

- `getAttachment`: obtain stable logical identity without asserting usability.
- `awaitUsable`: await the current initialized, validated attachment with caller cancellation;
  return its generation. This is evidence, not a guarantee that the next request succeeds.
- `revalidate`: validate the current attachment even when it was previously ready.
- `retry`: cancel backoff and expedite one fresh attempt; concurrent requests coalesce.
- `stop`: stop recovery immediately; ManagedHostConnection separately persists disconnected intent.

One caller cancelling its wait does not cancel work still owned by other demand. Explicit
Disconnect, removal, identity changes, and shutdown supersede all work for the old identity.

## Validation and recovery

Use a correlated health request over the existing Wire channel. A successful new channel or
an SSH keepalive cannot validate the channel serving the current logical attachment. Health
requests are generation-bound and must never be held for delivery on a replacement transport.
An ordinary RPC timeout requests validation; it is not conclusive evidence that SSH is dead.

Initial tuning is a 15-second health interval and a five-second response deadline while a
runtime attachment is maintained. These are configurable policy inputs to the supervisor,
not timing constants scattered through transports. Routine focus/online hints and idle polling
keep a ready attachment usable while previous evidence remains fresh (within the health interval
plus its response deadline). These probes preserve the ready snapshot on success, avoiding UI
flicker, unnecessary store refreshes, and rejected terminal input. A failed probe demotes availability
within its response deadline. Expiry or an explicit failure demotes
availability; a small amount of incidental traffic must not indefinitely hide a wedged
request/response path. Serving readiness or SSH-access requests does not move an already scheduled
health deadline.

Resume immediately makes pre-sleep evidence uncertain and supersedes unfinished pre-sleep
attempts. Probe an established attachment before replacing it. Focus/online hints are
coalesced and throttled; neither bypasses stopped/blocked policy. Validate retained SSH and Wire
evidence concurrently so dead SSH does not consume
another channel-open deadline before replacement. An online hint expedites a scheduled backoff
without cancelling useful in-flight work. ACP attachment retries belong to the retained chat
session and continue after transient failure even within the same Host generation; only successful
attachment plus snapshot refresh records that generation as recovered. Cancellation fences late
attachment responses. The Project content tree remains mounted across availability transitions,
with a compact connection footer below the workspace instead of a banner above its tabs.
Detect long scheduling gaps
as additional uncertainty; do not rely on paused timers replaying missed health intervals.
Use elapsed time for deadlines, and explicit resume/gap handling for evidence freshness.

On failed Wire validation, detach the failed transport and attempt bounded channel replacement
and initialization. When channel establishment stalls, use bounded independent SSH validation
and replace SSH if necessary. If SSH responds but the daemon does not, report/recover at the
server layer instead of repeatedly resetting healthy SSH. Every establishment, channel-open,
initialization, and validation stage must settle within its budget. Start with ten-second
channel-open and initialization budgets; SSH handshake timeout follows the resolved connection
policy, with a 120-second overall establishment ceiling including configuration resolution.
Preparation and explicit server operations also have 120-second ceilings. Cancellation must release
waiters; resources returned by late callbacks must be closed.

Only a current candidate that passed initialize can be installed. Installation triggers Wire
reattachment; Host readiness is published after the control plane is usable. Individual Project,
terminal, and ACP attachments separately expose their resynchronization status. One failed
session must not prevent the Host control plane from becoming ready.

Transient failures retry with capped, jittered backoff while connection policy remains active.
Every attempt is bounded, but transient retry lifetime is not. Authentication, host-key,
configuration, unsupported-platform, and incompatible-protocol failures stop automatic retries
with a typed actionable issue. This replaces the current bounded overall Host recovery policy.
Retry timing uses the shared injectable `RetrySchedule`, including repeat-last and jitter policies.
Attempts and probes run in child Scopes; generation checks still fence late external results.
Clocks are injectable for deterministic tests. Healthy-but-unresponsive daemon
recovery does not automatically restart the daemon: restart remains an explicit operation,
because sessions and other clients may be affected.

Explicit server operations capture their Host operation scope before entering the per-Host queue.
Disconnect, identity replacement, and shutdown cancel queued and active operations. Each continuation
checks cancellation before further daemon actions or publication. Completion is handled for success,
failure, and timeout: successful Stop remains paused; successful Start/install/restart/update resumes
runtime maintenance; failure exposes manual recovery with an issue. Runtime pausing rejects existing
readiness waiters. A Connect cannot bypass an in-flight daemon operation.

## UI and operation semantics

Machine and task usability indicators derive from Host availability. Preserve Project contexts,
transcripts, terminal display, and logical session identities through outages. Routine checks of
a recently healthy attachment remain invisible and accept live input. Show checking after sleep,
expired evidence, or an explicit request failure; show reconnecting or a specific blocked issue
when recovery is needed, and gate Host-dependent actions. Do not silently queue
terminal keystrokes for later execution.

Transport recovery does not replay already-sent mutations. A lost reply leaves the operation's
outcome uncertain; existing domain receipts, idempotency, and reconciliation resolve it. ADR 0005
plain-RPC workspace semantics and ADR 0006 deletion semantics remain unchanged. Initialization
and health success do not establish that every worker or remote Session is healthy.

## Implementation and acceptance

Introduce the controlled adapters and supervisor, then switch production lifecycle ownership
in one cutover. Remove the remote SSH manager retry loop, remote Wire reconnect policy, and
Host availability recovery loop together. Migrate startup, demand, machine controls, host
attachment registry, and SSH-only consumers. Never run two recovery owners for the same Host.
Local Host worker supervision remains outside this remote-connection replacement.

The `connection-supervisor.acceptance.test.ts` suites under the Hosts and SSH node services,
the lifecycle policy suite, and the gateway integration tests exercise the production supervisor,
Wire, SSH manager, and stream-local operations against faulting protocol peers. All acceptance
assertions are ordinary tests; there are no expected-failure markers or strict-mode switches.
Terminal recovery tests retain the displayed terminal while rehydrating its backend; the ACP
recovery test uses real Wire live models to refresh a retained logical session after replacement.

The complete cutover must cover:

- silent packet loss without close/error and bounded availability demotion;
- wakeups validating previously ready connections;
- current readiness awaiting replacement initialization while logical identity survives;
- hung channel opening, late candidates, and cancellation during initialization;
- transient outages extending beyond current retry budgets;
- protocol/authentication failures stopping retries;
- stable subscriptions refreshing after daemon replacement;
- lost mutation replies without replay;
- coalesced wakeups/retries and explicit Disconnect suppressing recovery;
- physical SSH replacement without stale-client callbacks damaging the replacement;
- real resume during SSH establishment and Wire initialization;
- terminal and ACP attachment recovery with truthful UI state.

The protocol fixtures do not emulate TCP, real SSH authentication, OS suspend, or rendered UI.
Those require adapter and application integration tests at cutover. Keep that distinction
explicit in test reporting. Log host identity, attempt/generations, trigger, failed phase,
last validation, and next retry, using existing redaction and logging rules.

## Module layout after the incremental refactor

Public Node ports live in `api/node/`: `host-service.ts`, `host-connection.ts`,
`host-runtime.ts`, and `host-workspace-server.ts`. Implementation lives in `node/`:

```text
node/
  hosts.ts                         lookup, identity lifetime, leases, aggregate events
  host-service.ts                  compose the services for one remote Host
  managed-host-connection.ts        leases, pin, persisted intent
  connection-supervisor.ts         recovery transitions, retries, health, maintenance coordination
  host-runtime-connection.ts       stable Wire identity and bounded transport work
  remote-host-workspace-server.ts  observable daemon state and maintenance queue
  availability.ts                  local/remote routing and Wire availability projection
  worker-host-availability.ts      adapter-managed local worker readiness
  state-model.ts                   aggregate workspace-server state
  runtime-resolution.ts            typed error translation
  wire-controller.ts               Wire procedure integration
  settings.ts                      Host service settings
  workspace-server/
    connect/                       bounded transports, initialization and one-shot dialing
    provision/                     Host probe, provisioning, installation and daemon control
    layout.ts, ports.ts, targets.ts adapter data and filesystem layout
  testing/                         shared protocol fault fixtures
```

Tests are colocated with their implementation. Recovery transitions, retry decisions, health
validation and waiter eligibility remain in the supervisor: splitting them would require exposing
the same mutable policy through several interfaces. Transport ownership and daemon maintenance
already have independent implementations. The shared availability projection cannot prepare a
remote Host through the local worker adapter.
