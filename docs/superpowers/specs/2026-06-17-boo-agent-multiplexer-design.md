# Design: Pluggable agent-session multiplexer (boo + tmux)

- **Date:** 2026-06-17
- **Status:** Draft — for review
- **Area:** `apps/emdash-desktop/src/main/core/{pty,conversations,terminals,dependencies,settings,workspaces}`
- **Related:** `agents/risky-areas/pty.md`, `agents/risky-areas/ssh.md`, `AGENTS.md` (project settings, PTY env allowlist)

## 1. Summary

Introduce a small **multiplexer-backend abstraction** so persistent agent sessions can run on
[`coder/boo`](https://github.com/coder/boo) — a terminal multiplexer built on Ghostty's
`libghostty` VT core — instead of tmux. boo becomes the **preferred backend for agent
(conversation) sessions** when present; **tmux remains the fallback** and continues to back
plain terminal sessions. The change is local **and** remote (SSH), and boo is made available
via **detect-and-install** (no bundled binary). Persistence stays opt-in; this swaps the
*mechanism*, not the default.

## 2. Motivation

tmux double-emulates: when emdash spawns `tmux attach` as the PTY, the agent's output is parsed
and redrawn by tmux's terminal emulator *before* xterm.js in the renderer ever sees it. tmux's
emulator lags modern escape sequences, so rich agent TUIs (truecolor, alt-screen, complex
redraws, Nerd-font/box-drawing glyphs) render poorly. This is the reported pain: **"tmux
rendering is horrible for agents."**

boo exists specifically to fix this — it replaces screen's/tmux's dated VT layer with
`libghostty`, parsing every session's output through Ghostty's emulation core. For emdash's
attach-and-stream flow, that means faithful rendering of exactly the agent output that tmux
mangles today, while keeping the persistence we rely on.

## 3. Background: how emdash uses tmux today

tmux is **shallowly coupled** — a boolean flag plus one isolated shell-line builder, not a
pervasive assumption.

- **Command builder** — `src/main/core/pty/tmux-session-name.ts`:
  - `buildTmuxShellLine(sessionName, commandLine)` returns a `/bin/sh -c '…'` line:
    ```
    (tmux has-session -t NAME 2>/dev/null
       || tmux -u new-session -d -s NAME CMD)
    && (tmux set-option -t NAME mouse on ...) && (tmux set-option -t NAME history-limit 100000 ...)
    && tmux -u attach-session -t NAME
    ```
    The `-u` flag forces UTF-8 regardless of the GUI-launched app's (often empty) `LANG`.
  - `makeTmuxSessionName(sessionId)` → `emdash-<base64url(sessionId)>`.
  - `killTmuxSession(ctx, name)` → `ctx.exec('tmux', ['kill-session', '-t', name])`.
- **Spawn wiring** — `pty/pty-spawn-platform.ts`, `pty/spawn-utils.ts` integrate the shell line
  into local and SSH PTY spawns.
- **Providers** carry a `tmux: boolean` and branch on it in ~3–4 places each:
  - Agents: `conversations/impl/local-conversation.ts`, `conversations/impl/ssh-conversation.ts`
    — choose a session name when `tmux`, and **suppress respawn** on unexpected exit when `tmux`
    (keep the session alive for reattach instead of relaunching).
  - Terminals: `terminals/impl/local-terminal-provider.ts`,
    `terminals/impl/ssh-terminal-provider.ts` — same respawn-suppression + `killTmuxSession` on
    delete; the SSH terminal provider has a `rehydrate()` path to reattach after reconnect.
- **Flag flow** — `workspaces/workspace-factory.ts` resolves `tmuxEnabled` from project settings
  and passes `tmux` into each provider; `tasks/task-builder.ts` threads it through provisioning.
- **Settings** — per-project `tmux` boolean (`src/shared/core/project-settings/project-settings.ts`,
  `tmux: z.boolean().optional()`); app-level default `tmuxByDefault` (`settings/schema.ts`,
  `settings/settings-registry.ts` → **default `false`**, i.e. persistence is opt-in). UI toggle
  "Enable tmux" in `renderer/features/settings/components/TaskSettingsRows.tsx`.
- **Shared types** carry `tmuxSessionName?: string` (`shared/core/agents/agent-session.ts`,
  `shared/core/terminals/general-session.ts`).
- **Renderer** is otherwise tmux-agnostic — it streams PTY bytes to xterm.js over RPC.

**Key consequence:** the persistence *behaviors* (respawn suppression, keep-alive on detach,
kill on delete) are about *"is this session persisted?"* — not specifically *"is this tmux?"*.
Only command construction, kill, and session-existence are genuinely tmux-specific.

## 4. What boo is (and its limits)

- Terminal multiplexer in Zig on `libghostty`; **CLI binary, not a library** → same integration
  model as tmux (spawn commands). MIT licensed.
- Persistence shape matches tmux: forked daemon owns the PTY over a Unix socket; sessions survive
  **client disconnect** (not machine reboot).
- Commands: `boo new <name> [-d] -- <cmd>`, `boo attach <name>`, `boo ls [--json]`,
  `boo kill <name>`, plus automation primitives `boo send`, `boo wait --idle|--text`,
  `boo peek --scrollback|--json`.
- **Limits relevant here:** no networking/SSH (local Unix socket only); **macOS + Linux only, no
  Windows**; one attached client per session (**attach steals**); one window per session (no
  splits/tabs — fine, emdash uses one session per entity); `C-a` prefix not configurable;
  `TERM` pinned to `xterm-256color`. Maturity: **v0.5.x, ~646 stars, self-described "young
  project, not a drop-in replacement."**

## 5. Goals / Non-goals

**Goals**
- Agent sessions render faithfully by running persistence through boo when available.
- A clean, testable backend abstraction (tmux + boo) rather than a second scattered flag.
- Local and remote (SSH) parity for agent sessions.
- Graceful fallback to tmux (then to no-persistence) when boo is absent.
- No behavior change for existing users who haven't opted into persistence.

**Non-goals (v1)**
- Moving terminal sessions onto boo (they stay on tmux).
- A user-facing backend picker.
- Flipping persistence to default-on.
- Windows support for persistence (already disabled for tmux; boo n/a).
- Using boo's `send`/`peek`/`wait` automation primitives (possible future cleanup, not now).

## 6. Locked decisions (from brainstorming)

1. **Strategy:** pluggable backend; boo is the **default for agent sessions**; tmux is the
   fallback and stays for terminals.
2. **Remote:** local **and** remote parity — both local and SSH agent providers use boo when
   detected on the host running the agent.
3. **Distribution:** **detect-and-install** — no bundled binary; detect boo (local + over SSH),
   offer install when missing (consented locally; provision step remotely); fall back to tmux.

## 7. Design

### 7.1 Backend abstraction

New module `src/main/core/pty/multiplexer/`:

```ts
export type MultiplexerId = 'tmux' | 'boo';
export type SessionKind = 'agent' | 'terminal';

export interface MultiplexerBackend {
  readonly id: MultiplexerId;
  makeSessionName(sessionId: string): string;
  /** A `/bin/sh -c '…'` line that ensures the session exists and attaches to it. */
  buildAttachShellLine(sessionName: string, commandLine: string): string;
  killSession(ctx: IExecutionContext, sessionName: string): Promise<void>;
}
```

- **`TmuxBackend`** — moves the existing `tmux-session-name.ts` logic behind the interface
  verbatim (no behavior change). `tmux-session-name.ts` becomes a thin re-export or is folded
  into `multiplexer/tmux.ts`.
- **`BooBackend`** — new implementation (§7.2).

### 7.2 boo command construction (candidate — pending spike, see §9)

```ts
const BOO_SESSION_PREFIX = 'emdash-';

export const booBackend: MultiplexerBackend = {
  id: 'boo',
  makeSessionName(sessionId) {
    return `${BOO_SESSION_PREFIX}${Buffer.from(sessionId, 'utf8').toString('base64url')}`;
  },
  buildAttachShellLine(sessionName, commandLine) {
    const name = JSON.stringify(sessionName);
    // Run the agent command under a shell so the existing command line is interpreted the
    // same way tmux interprets it. Escaping is security-sensitive — reuse existing quoting
    // helpers, do not hand-roll.
    const cmd = JSON.stringify(commandLine);
    // Create detached if missing (ignore "already exists"), then attach (exec → the PTY
    // becomes the boo client). boo has no `has-session`; rely on `new` being safe-to-fail.
    const script = `boo new ${name} -d -- /bin/sh -c ${cmd} 2>/dev/null; exec boo attach ${name}`;
    return `/bin/sh -c ${JSON.stringify(script)}`;
  },
  async killSession(ctx, sessionName) {
    try {
      await ctx.exec('boo', ['kill', sessionName]);
    } catch {
      /* already gone */
    }
  },
};
```

Notes vs tmux: no `-u` flag needed (Ghostty's VT is UTF-8 native — this is the point); no
`mouse`/`history-limit` set-option equivalents in the same shape (scrollback config is a spike
item, §9.3); `TERM` is fixed to `xterm-256color` by boo.

### 7.3 Backend selection & fallback

```ts
export interface DetectedMultiplexers { boo: boolean; tmux: boolean; }

const BACKENDS = { tmux: tmuxBackend, boo: booBackend } as const;

/** Returns the backend to use, or null = no persistence (spawn the bare command + warn). */
export function selectMultiplexer(
  kind: SessionKind,
  detected: DetectedMultiplexers,
  override?: MultiplexerId, // EMDASH_AGENT_MULTIPLEXER escape hatch (debug)
): MultiplexerBackend | null {
  if (kind === 'agent') {
    // EMDASH_AGENT_MULTIPLEXER forces a backend when detected; else warn + fall through.
    // Agent-only: gated inside this branch so terminals are never affected.
    if (override) {
      if (detected[override]) return BACKENDS[override];
      log.warn(`EMDASH_AGENT_MULTIPLEXER=${override} set but not detected; using normal selection`);
    }
    if (detected.boo) return booBackend;
    if (detected.tmux) return tmuxBackend;
    return null;
  }
  // terminals: unchanged — tmux only (override ignored)
  return detected.tmux ? tmuxBackend : null;
}
```

Selection happens where the provider currently reads `tmux` (workspace-factory / provider
construction), using detection results (§7.6) for the relevant host (local vs the SSH remote).

### 7.4 Provider integration

- Replace each provider's `tmux: boolean` with an injected `multiplexer: MultiplexerBackend | null`
  (selected per §7.3 for that provider's host and `kind`).
- The persistence branches become backend-agnostic: `if (this.multiplexer)` for
  respawn-suppression / keep-alive-on-detach; `this.multiplexer.killSession(...)` on delete;
  `this.multiplexer.makeSessionName(...)` / `buildAttachShellLine(...)` at spawn.
- **Agent providers** (`local-conversation.ts`, `ssh-conversation.ts`) pass `kind:'agent'` →
  boo-preferred.
- **Terminal providers** (`local-terminal-provider.ts`, `ssh-terminal-provider.ts`) pass
  `kind:'terminal'` → tmux only; behavior unchanged. `ssh-terminal-provider.rehydrate()` keeps
  working through the backend interface.
- **Backend identity must reach the spawn wrappers.** Today `pty/spawn-utils.ts`
  (`posixShellLineForSsh`) and `pty/pty-spawn-platform.ts` (`resolveLocalPtySpawn`) wrap with
  `buildTmuxShellLine` *keyed solely on* `tmuxSessionName` — so a boo name placed there would be
  tmux-wrapped. Replace the ephemeral `tmuxSessionName?: string` on the session config / spawn
  `intent` (`agent-session.ts`, `general-session.ts`) with **`multiplexer?: { id: MultiplexerId;
  sessionName: string }`**; the wrappers then call
  `backendFor(intent.multiplexer.id).buildAttachShellLine(...)`. This config is computed per spawn
  (the name is derived, not stored — cf. `deleteConversation` recomputing it), so it is **not** a
  persisted key and needs no migration — distinct from the persisted *settings* keys in §7.5.

### 7.5 Settings & defaults

- **Keep the persisted keys unchanged** to avoid any settings/DB migration — per-project `tmux`
  (`shared/core/project-settings/project-settings.ts`) and app-level `tmuxByDefault`
  (`settings/schema.ts`, `settings/settings-registry.ts`). Their stored names and meaning
  ("persistence on/off") stay; only the **UI label** becomes "Persistent sessions." Backend-
  agnostic naming lives solely in the new (non-persisted) abstraction layer.
- Backend is **auto-selected** (§7.3). **No user-facing backend picker in v1.** Provide an
  internal escape hatch `EMDASH_AGENT_MULTIPLEXER=tmux|boo` (must be added to the PTY env
  allowlist in `pty/pty-env.ts` if it needs to reach the PTY; otherwise read in main only).
- **Default stays OFF / opt-in** — no behavior change.
- UI (`TaskSettingsRows.tsx`): relabel "Enable tmux" → "Persistent sessions"; show the active
  backend (boo/tmux) and an install hint when persistence is on but boo is missing.

### 7.6 Detection & install

There is **no `dependency-manager.ts`**. The relevant pieces already exist but are agent-shaped:
- `dependencies/dependency-managers.ts` exposes a generic `HostDependencyManager` per host — one
  local, one per SSH `connectionId` — already doing detection, install (local + SSH runners),
  platform resolution (`resolveRemotePlatform` via `uname -s` → **`macos` or `linux`**), and
  selection/override storage.
- `dependencies/registry.ts` builds `DEPENDENCIES` **only from agent plugins**
  (`category: 'agent'`); the install/status RPC in `agents/controller.ts` is **agent-shaped**
  (`AgentProviderId`).
- tmux today is **assumed present** on `PATH` and is *never probed*. But `selectMultiplexer` and
  the §8 matrix branch on `detected.tmux`, so tmux now needs a **lightweight availability probe**
  too (local + per-SSH; e.g. `tmux -V` / resolve on `PATH`). **Detection** of tmux is in scope;
  **install management** of tmux stays optional (§14 Q4). boo would be the first fully managed
  core/tool dependency.

Plan:
- Add boo as a **core `DependencyDescriptor`** (non-`agent` category) in the registry. The generic
  `HostDependencyManager` then detects + installs it on local and per-`connectionId` SSH hosts for
  free, **platform-aware** (boo ships macOS + Linux installers).
- Populate `detected = { boo, tmux }` from per-host availability probes (the `HostDependencyManager`
  already probes; register tmux as **detection-only** even if unmanaged) — this feeds
  `selectMultiplexer` (§7.3) and the §8 matrix.
- Expose a **core-dependency RPC/UI surface** instead of reusing the agent-shaped one — either
  generalize `agents/controller.ts` to accept non-agent ids, or add a sibling controller (§14).
- **When persistence is on for an agent and boo is missing on the host that will run it:**
  - **Local:** consented "Install boo" via the local `HostDependencyManager` (official installer
    for the local platform; manual instructions as fallback). Fall back to tmux meanwhile.
  - **Remote — both workspace shapes:** normal **project-SSH** tasks
    (`workspace-bootstrap-service.ts` → `_acquireAndBuild` / `createWorkspaceFactory`, keyed on
    `project.defaultWorkspaceType`) **and** BYOI. Drive detect/install through the SSH
    `HostDependencyManager` for that `connectionId` during task bootstrap — not by editing one
    provision script — so both paths and both remote platforms are covered.
- **Security-sensitive:** installer execution must be gated behind explicit action, pinned to a
  known method, and use the existing install-runner patterns. Flag for review.

### 7.7 Session lifecycle

| Phase | tmux | boo |
| --- | --- | --- |
| Name | `emdash-<base64url(id)>` | same scheme (spike: confirm boo name charset) |
| Create | `new-session -d -s NAME CMD` | `boo new NAME -d -- sh -c CMD` |
| Attach | `attach-session -t NAME` | `boo attach NAME` |
| Reattach | re-run attach line | re-run attach line (`ssh-terminal-provider.rehydrate()`) |
| Kill | `kill-session -t NAME` | `boo kill NAME` |
| Survives | client disconnect | client disconnect |

### 7.8 Orphan / stale session cleanup (backend- and host-aware)

Two paths kill sessions **without** a live provider, by recomputing the deterministic name from
`(projectId, taskId, leafId)` and calling tmux directly: `conversations/deleteConversation.ts`
(fires when the task is already torn down) and `tasks/task-session-manager.ts` →
`cleanupDetachedSessions` (teardown-failure fallback). Two problems for boo:

- **Backend identity.** As written they kill only the *tmux* name, so a boo-backed session leaks.
- **Host identity.** Both target the *project* context — `deleteConversation` uses `project.ctx`,
  and `cleanupDetachedSessions` uses the `ctx` stored at `registerTask` (also `project.ctx`,
  `tasks/task-service.ts`). But a **BYOI** session runs on the *task's* SSH connection (the
  sandbox), not the project host — so a kill on `project.ctx` hits the wrong machine and leaks the
  real session.

Fix: a backend- and host-aware `killSessionById({ hostCtx, kind, sessionId })` helper.
- **Host (project-SSH):** `persistData.sshConnectionId` is a **persisted `ssh_connections` row**,
  so `connect(id)` reconnects and runs the kill. Local/project workspaces use local/project ctx.
- **Host (BYOI) — the hard case:** BYOI connects via *ephemeral* `connectFromConfig`
  (`ssh-connection-manager.ts`), not a persisted row, and `workspaces.data` holds only
  `provisionCommand` / `terminateCommand` / `remoteWorkspaceId` — **no credentials**
  (`workspace-provider-data.ts`). So `connect(sshConnectionId)` **cannot** reach a BYOI sandbox
  after the proxy closes. Strategy:
  - Store the **live BYOI proxy ctx** (the session host) at `registerTask` instead of `project.ctx`,
    so in-process cleanup while the task is still registered uses it directly — covers the common
    teardown/delete path.
  - On **`terminate`**, BYOI runs `terminateCommand`, which destroys the whole sandbox → every
    session dies; no per-session remote kill needed.
  - For **detached BYOI after the proxy is gone** (e.g. app restart): remote per-session cleanup is
    **best-effort / deferred** — the session is reaped by a later sandbox `terminate`, or reconciled
    on reattach (which already re-runs provision via `remoteWorkspaceId` to reconnect). Do **not**
    re-run the provision script from the cleanup fallback just to kill one session (disproportionate
    + side-effecting). Documented as an explicit limitation (§14).
- **Backend:** with no stored backend id and `makeSessionName` deterministic, kill **both** backend
  names for agent/conversation ids (tmux-only for terminal ids); idempotent. (A persisted
  per-session `multiplexerId` — §14 — would narrow this.)

## 8. Fallback / degradation matrix (agent sessions)

| Persistence | boo present | tmux present | Result |
| --- | --- | --- | --- |
| off | — | — | bare PTY, no persistence (today's default) |
| on | yes | — | **boo** (goal state) |
| on | no | yes | tmux (works, but the rendering pain persists) + install hint |
| on | no | no | bare PTY, no persistence + warning (matches current "tmux unsupported" path) |

## 9. Unknowns to verify FIRST (spike, before full wiring)

1. **Create-then-attach in one line** — is `boo new` safe-to-fail when the session already
   exists, and does `boo attach` stream like `tmux attach`? Confirm the §7.2 line (or find the
   right idiom, e.g. guard on `boo ls --json`).
2. **Resize / SIGWINCH — highest risk.** emdash resizes the PTY from the renderer on window
   resize; the agent must reflow. Confirm `boo attach` forwards client terminal-size changes to
   the child PTY. **If boo does not propagate resize, it is not a viable terminal backend** and
   this whole effort stops here.
3. **Scrollback cap** vs tmux's `history-limit 100000` — does boo bound history, and is it
   configurable? Affects parity of agent scrollback.
4. **Session-name charset** — base64url uses `-` and `_`; confirm boo accepts them as names.
5. **The actual rendering win** — quick A/B of a representative agent under boo vs tmux to
   confirm the motivation holds before investing in full integration.

The spike should be a throwaway: detect/install boo locally, hand-run the candidate shell line
against a real agent, and check items 1–5.

## 10. Testing strategy

- **Unit:** `BooBackend.buildAttachShellLine` / `makeSessionName` (mirror existing tmux tests if
  present); `selectMultiplexer` decision matrix (kind × detected × override — incl. override
  force/warn **and** that override is ignored for `kind:'terminal'`); spawn wrappers
  (`resolveLocalPtySpawn` / `posixShellLineForSsh`) wrap with the backend named by
  `intent.multiplexer.id`; `killSessionById` kills both backends for conversation ids (tmux-only
  for terminals) **on the resolved session host**; session-name encoding round-trip.
- **Integration (`main-db`/node):** spawn a real boo agent session **guarded by detection**
  (skip when boo absent): assert attach, persist-across-detach, and kill. Detection tests for
  local and mocked SSH.
- **Manual:** the §9 rendering A/B; disconnect→reattach persistence, **local and remote**;
  fallback-to-tmux when boo is removed from `PATH`.
- **Merge gate:** `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test`.

## 11. Affected files (initial estimate)

- New: `src/main/core/pty/multiplexer/{index,types,tmux,boo,select}.ts` (+ tests).
- Modify: `pty/tmux-session-name.ts` (fold/re-export), `pty/pty-spawn-platform.ts`,
  `pty/spawn-utils.ts`.
- Modify: `conversations/impl/local-conversation.ts`, `conversations/impl/ssh-conversation.ts`,
  `terminals/impl/local-terminal-provider.ts`, `terminals/impl/ssh-terminal-provider.ts`.
- Modify: `workspaces/workspace-factory.ts`, `tasks/task-builder.ts`.
- Modify: `dependencies/registry.ts` (register boo as a core, non-`agent` dependency, and tmux as
  **detection-only**), `dependencies/dependency-managers.ts` (expose them on the local + per-SSH
  managers), and the install/status RPC+UI (generalize `agents/controller.ts` for non-agent deps,
  or add a sibling core-deps controller). Drive remote detect/install through the existing
  per-`connectionId` `HostDependencyManager` during task bootstrap (covers project-SSH **and**
  BYOI, macOS **and** Linux) — not a single provision script.
- Modify: `conversations/deleteConversation.ts`, `tasks/task-session-manager.ts`, and the ctx
  stored at `tasks/task-service.ts` — store the **session-host ctx** (the live BYOI proxy for
  BYOI; project/local otherwise), not `project.ctx` (backend- **and host-**aware orphan cleanup,
  §7.8).
- Modify: `shared/core/agents/agent-session.ts`, `shared/core/terminals/general-session.ts`
  (replace ephemeral `tmuxSessionName` with `multiplexer?: { id, sessionName }`; computed per
  spawn, not persisted → no migration), and
  `renderer/features/settings/components/TaskSettingsRows.tsx` (relabel the toggle only). The
  **persisted settings** keys `tmux` / `tmuxByDefault` stay unchanged — no settings migration.
- Possibly: `pty/pty-env.ts` (if the escape-hatch env var must reach the PTY).

## 12. Risks

- **Maturity (high, soft):** v0.5 dependency in a core path. Mitigation: tmux fallback,
  opt-in default, escape hatch.
- **Resize propagation (high, blocking if unsupported):** see §9.2 — gates the whole effort.
- **Remote install burden (medium):** boo must be detected/installed per remote host (macOS or
  Linux) across **both** project-SSH and BYOI workspaces — handled via the per-connection
  `HostDependencyManager`, not a one-off provision script.
- **Security (medium):** installer execution and shell-line escaping are sensitive; reuse
  existing quoting/install helpers, gate installs behind consent.
- **attach-steals (low):** a user manually `boo attach`-ing the app's session would steal it;
  acceptable edge case.
- **Detached-BYOI orphan cleanup (low):** a session orphaned on a detached BYOI sandbox after the
  proxy closes is reaped by a later `terminate` / reattach, not immediately (§7.8, §14 Q8).

## 13. Scope boundaries (YAGNI)

In: agent sessions (local + SSH), backend abstraction, detection + consented/provisioned install,
tmux fallback. Out: terminals on boo, backend-picker UI, default-on persistence, Windows,
boo automation primitives.

## 14. Open questions for reviewer

1. **Settings naming (proposed: keep + relabel).** Keep the persisted settings keys `tmux` /
   `tmuxByDefault` and only relabel the UI (no migration) — confirm, or prefer a clean rename +
   migration? (The ephemeral session-config `tmuxSessionName` is separately restructured to
   `multiplexer` in §7.4 — it is computed per spawn, not a persisted key.)
2. **Orphan cleanup (proposed: kill-both).** Have the §7.8 helper kill both deterministic backend
   names (migration-free) vs persist a per-session `multiplexerId` for precision (needs a Drizzle
   migration + fixtures/migration-test updates)?
3. **Core-dependency surface.** Generalize the agent-shaped install RPC/UI
   (`agents/controller.ts`, `dependencies/registry.ts`) for non-agent deps, or add a separate
   core-deps controller?
4. **Manage tmux installs too?** tmux is now always **detected** (§7.6, needed by selection). The
   open part is *install management*: bring tmux under managed install/update alongside boo, or
   keep install out of scope (detection-only) and assume the user has tmux?
5. Local install: **auto-run** the official installer (with a consent prompt) vs **link/instruct
   only**?
6. Is **terminals-stay-on-tmux** acceptable long-term, or should there be a follow-up to unify?
7. Keep the **`EMDASH_AGENT_MULTIPLEXER` escape hatch**, or rely purely on detection?
8. **Detached-BYOI remote cleanup (proposed: best-effort).** Accept that an orphaned session on a
   detached BYOI sandbox is reaped by a later `terminate` / reattach reconciliation (no remote kill
   from the cleanup fallback), vs guaranteeing it by re-running provision via `remoteWorkspaceId`
   to reconnect (heavier, side-effecting), vs persisting safe reconnect metadata?

## 15. Future work

- Move terminals onto boo once proven; retire tmux entirely if desired.
- Use boo's `peek --json` / `wait --idle` to simplify rehydration and health checks.
- Reconsider persistent-by-default for agents once boo is validated in the field.
