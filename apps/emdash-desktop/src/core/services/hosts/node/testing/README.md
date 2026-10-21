# Host connection supervisor tests

These tests cover [ADR 0008](../../../../../../../../docs/adr/0008-host-connection-supervisor.md).
The driver runs the production `ManagedHostConnection`, its `HostConnectionSupervisor`, Wire clients, controllers, session
hub, and live models. Only physical/network and persistence boundary ports are faulted.
All assertions run normally; there is no expected-failure or strict acceptance mode.

Run from the repository root:

```bash
pnpm --filter @emdash/emdash-desktop exec vitest run --project node src/core/services/hosts/node src/core/services/ssh/node/connection-supervisor.acceptance.test.ts src/main/gateway/host-supervisor.ssh.test.ts src/main/gateway/host-availability.test.ts src/core/features/terminals/browser/pty/pty-session-recovery.test.ts src/core/features/conversations/browser/acp/acp-recovery.test.ts
pnpm --filter @emdash/wire run test
```

## Fault model

The protocol peer independently drops requests/replies without emitting disconnect, stalls
channel opening or initialization, makes new opens fail, and changes daemon identity or protocol.
Fake timers drive production scheduling and RPC deadlines. A remote counter verifies subscription
refresh and uncertain mutation outcomes without replay.

The policy suite covers suspend/resume, independent waiter cancellation, typed permanent failures,
intent write ordering/failure, SSH-only health, and releasing scoped runtime demand.
The managed-connection suite exercises public leases, pins, typed Disconnect failures, stale
persistence reads, and the legacy demand-mode adapter without mocking the supervisor.
The gateway SSH suite combines the real supervisor and SSH manager to supersede pre-sleep
establishment and fence late ready/close events. Hosts tests cover the production composition,
identity replacement, stable availability observations, and retained demand.

The terminal test verifies backend rehydration, retained display identity, and discarded offline
input. The ACP test retains its logical session and refreshes real Wire live models on replacement;
session usability stays false until reattachment completes. These do not launch provider processes.

## Application validation

The machine-details browser test runs in Chromium. Real OS sleep/resume, VPN transitions, TCP
blackholes, real authentication, and full remote PTY/provider-process recovery still require a
configured integration environment or manual smoke test. The opt-in Docker SSH test is available
through `pnpm --filter @emdash/emdash-desktop run test:workspace-server-remote`; it resets the
dedicated test user's managed workspace-server directory and must not target a personal machine.
Automated in-memory results are not evidence that those physical scenarios were exercised.
