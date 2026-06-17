# boo Agent-Session Multiplexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let persistent **agent** sessions run on `coder/boo` (libghostty VT core) instead of tmux, so agent TUI output renders faithfully, with tmux as the automatic fallback.

**Architecture:** Introduce a pluggable `MultiplexerBackend` abstraction (`tmux` + `boo`) behind the existing persistence flag. A per-host availability probe feeds `selectMultiplexer`, which prefers boo for agent sessions and falls back to tmux; terminal sessions stay on tmux. Backend identity flows into the PTY spawn wrappers and into a backend-/host-aware orphan-cleanup helper. boo is detected per-host at bootstrap (via the host's live execution context); when absent, the session falls back to tmux. Installing boo is **on-demand and consented** via a core-deps RPC that works for local, project-SSH, and BYOI hosts by reusing the live SSH proxy (never a persisted reconnect).

**Tech Stack:** TypeScript (strict), Electron main process, Vitest (`node` project), Drizzle (no migration in this plan), the shared host-dependency runtime in `packages/shared`.

**Design spec:** `docs/superpowers/specs/2026-06-17-boo-agent-multiplexer-design.md` (approved). Section references below (e.g. §7.3) point at it.

## Global Constraints

Every task's requirements implicitly include this section.

- **Runtime:** Node `24.14.0` (`.nvmrc`), `pnpm@10.28.2`. Run app commands from `apps/emdash-desktop/`.
- **Formatting:** `oxfmt`, `printWidth` 100, 2-space indent, semicolons, single quotes in TS, sorted imports. No `any`.
- **Tests:** Vitest `node` project for `src/**/*.test.ts` (`import { describe, expect, it } from 'vitest'`). Run a single file with `pnpm vitest run <path>`.
- **Merge gate (run before finishing):** `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test`.
- **Scope:** boo is preferred **only for agent (conversation) sessions**; **terminals stay on tmux**; persistence stays **OFF by default / opt-in** (settings keys `tmux` and `tmuxByDefault` are unchanged — UI label only).
- **Approved decisions (spec §14):** Q1 keep settings keys + relabel UI (no settings migration); Q2 orphan cleanup kills **both** backend names — **no `multiplexerId` column, no Drizzle migration**; Q3 expose core deps via a **sibling controller**, not by overloading the agent RPC; Q4 tmux is **detection-only** (no managed install); Q5 local boo install **auto-runs the official installer behind a consent prompt**; Q6 terminals stay tmux; Q7 keep the `EMDASH_AGENT_MULTIPLEXER` escape hatch; Q8 detached-BYOI remote cleanup is **best-effort**.
- **Security:** new shell-line construction must quote every interpolated value with `quoteShellArg` / `quoteCshArg` from `@main/utils/shellEscape` — **never `JSON.stringify`** (its double-quote semantics leave `$`, backticks, and globs shell-active). The `tmuxBackend` delegates to the pre-existing `buildTmuxShellLine`, which predates this work and is left unchanged. Installer execution is gated behind explicit user consent.
- **Spike gate:** Task 0 must pass before any other task. If boo does not propagate terminal resize (SIGWINCH) to the child PTY, **STOP** — boo is not a viable backend.

## File Structure

New module `apps/emdash-desktop/src/main/core/pty/multiplexer/`:

- `types.ts` — `MultiplexerId`, `SessionKind`, `MultiplexerBackend` interface.
- `tmux.ts` — `tmuxBackend` (wraps existing `tmux-session-name.ts`).
- `boo.ts` — `booBackend`.
- `select.ts` — `DetectedMultiplexers`, `BACKENDS`, `backendFor`, `selectMultiplexer`.
- `cleanup.ts` — `killSessionById` (backend-/host-aware orphan cleanup).
- `index.ts` — re-exports.
- `*.test.ts` — colocated unit tests.

Modified (each named in its task):
- `pty/spawn-utils.ts`, `pty/pty-spawn-platform.ts` — spawn wrappers dispatch on backend id.
- `shared/core/agents/agent-session.ts`, `shared/core/terminals/general-session.ts` — `tmuxSessionName` → `multiplexer?: { id, sessionName }`.
- `conversations/impl/local-conversation.ts`, `conversations/impl/ssh-conversation.ts`, `terminals/impl/local-terminal-provider.ts`, `terminals/impl/ssh-terminal-provider.ts` — `tmux: boolean` → `multiplexer: MultiplexerBackend | null`.
- `workspaces/workspace-factory.ts` (+ the conversation-provider builder) — select backend per host/kind.
- `dependencies/registry.ts` (+ new `core-deps/descriptors.ts` & `core-deps/detect-multiplexers.ts`) — register boo (managed) + tmux (detection-only) as `'core'` deps; `detectMultiplexers()`. No shared type-union changes (`DependencyId = string`, `'core'` already exists).
- `conversations/deleteConversation.ts`, `tasks/task-session-manager.ts`, `tasks/task-service.ts` — host-aware cleanup + store session-host ctx.
- `renderer/features/settings/components/TaskSettingsRows.tsx` — relabel + backend/install hint.
- `main/core/dependencies/core-deps/controller.ts` (new) + `main/rpc.ts` — sibling core-deps RPC.

---

### Task 0: Spike — validate boo before building (GATE, throwaway)

**This task is manual verification, not TDD. It produces no shipped code.** Record findings in the spec's §9 (append a "Spike results" note). Do not proceed to Task 1 until the resize check passes.

**Files:**
- Modify (notes only): `docs/superpowers/specs/2026-06-17-boo-agent-multiplexer-design.md` (append spike results under §9).

- [ ] **Step 1: Install boo locally**

Run: `curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh`
Then: `boo --version`
Expected: prints a version (e.g. `0.5.x`). If the install path isn't on `PATH`, note where the binary landed (`~/.local/bin` or `/usr/local/bin`).

- [ ] **Step 2: Confirm create-then-attach in one shell line (§9.1)**

Run:
```bash
boo new emdash-spike -d -- /bin/sh -c 'exec /bin/bash -il'
boo ls
boo new emdash-spike -d -- /bin/sh -c 'exec /bin/bash -il'   # second create when it already exists
echo "exit code of second create: $?"
```
Record: does the second `boo new` exit non-zero / print "already exists"? Does the candidate idiom `boo new NAME -d -- … 2>/dev/null; exec boo attach NAME` (spec §7.2) reattach cleanly? If `boo new` aborts the line on failure, note the corrected idiom (e.g. guard with `boo ls`).

- [ ] **Step 3: Resize / SIGWINCH — the gate (§9.2)**

Run `boo attach emdash-spike`, start a TUI inside (e.g. `htop` or `vim`), then resize the terminal window. Detach with `Ctrl-A d`.
Record: did the TUI reflow to the new size? **If resize does NOT propagate, STOP the whole effort and report back — boo cannot be the backend.**

- [ ] **Step 4: Scrollback + name charset (§9.3, §9.4)**

Run `boo peek emdash-spike --scrollback | wc -l` after emitting a few hundred lines; note any history cap vs tmux's 100000. Then `boo new 'emdash-aGVsbG8_-x' -d -- /bin/sh -c 'true'; boo ls` to confirm base64url chars (`-`, `_`) are accepted as names.

- [ ] **Step 5: Rendering A/B (§9.5)**

Run a representative agent CLI under tmux (`tmux new-session …`) and under boo (`boo new … -d -- <agent>; boo attach`). Confirm boo renders the agent's output more faithfully. This is the motivation check.

- [ ] **Step 6: Clean up and record**

Run: `boo kill emdash-spike; boo kill 'emdash-aGVsbG8_-x'`
Append a "Spike results" subsection to §9 of the spec capturing: confirmed boo command idiom, resize=PASS/FAIL, scrollback cap, name charset OK, rendering verdict. Commit the spec note:
```bash
git add docs/superpowers/specs/2026-06-17-boo-agent-multiplexer-design.md
git commit -m "docs(boo): record multiplexer spike results"
```

---

### Task 1: Multiplexer backend interface + tmux backend

**Files:**
- Create: `src/main/core/pty/multiplexer/types.ts`
- Create: `src/main/core/pty/multiplexer/tmux.ts`
- Test: `src/main/core/pty/multiplexer/tmux.test.ts`

**Interfaces:**
- Consumes: `buildTmuxShellLine`, `makeTmuxSessionName`, `killTmuxSession` from `@main/core/pty/tmux-session-name`; `IExecutionContext` from `@main/core/execution-context/types`.
- Produces:
  - `type MultiplexerId = 'tmux' | 'boo'`
  - `type SessionKind = 'agent' | 'terminal'`
  - `interface MultiplexerBackend { id: MultiplexerId; makeSessionName(sessionId: string): string; buildAttachShellLine(sessionName: string, commandLine: string): string; killSession(ctx: IExecutionContext, sessionName: string): Promise<void> }`
  - `const tmuxBackend: MultiplexerBackend`

- [ ] **Step 1: Write the failing test**

Create `src/main/core/pty/multiplexer/tmux.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { tmuxBackend } from './tmux';

describe('tmuxBackend', () => {
  it('has id "tmux"', () => {
    expect(tmuxBackend.id).toBe('tmux');
  });

  it('makeSessionName matches the emdash-<base64url> scheme', () => {
    expect(tmuxBackend.makeSessionName('p:t:c')).toBe(
      `emdash-${Buffer.from('p:t:c', 'utf8').toString('base64url')}`
    );
  });

  it('buildAttachShellLine produces the has-session/new-session/attach tmux line', () => {
    const line = tmuxBackend.buildAttachShellLine('agent-session', 'exec /bin/zsh -il');
    expect(line).toMatch(/^\/bin\/sh -c /);
    expect(line).toContain('tmux has-session -t \\"agent-session\\"');
    expect(line).toContain('tmux -u attach-session -t \\"agent-session\\"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/pty/multiplexer/tmux.test.ts`
Expected: FAIL — cannot resolve `./tmux`.

- [ ] **Step 3: Write the interface and tmux backend**

Create `src/main/core/pty/multiplexer/types.ts`:
```ts
import type { IExecutionContext } from '@main/core/execution-context/types';

export type MultiplexerId = 'tmux' | 'boo';
export type SessionKind = 'agent' | 'terminal';

export interface MultiplexerBackend {
  readonly id: MultiplexerId;
  /** Deterministic, shell-safe session name for a pty session id. */
  makeSessionName(sessionId: string): string;
  /** A `/bin/sh -c '…'` line that ensures the session exists and attaches to it. */
  buildAttachShellLine(sessionName: string, commandLine: string): string;
  killSession(ctx: IExecutionContext, sessionName: string): Promise<void>;
}
```

Create `src/main/core/pty/multiplexer/tmux.ts`:
```ts
import {
  buildTmuxShellLine,
  killTmuxSession,
  makeTmuxSessionName,
} from '@main/core/pty/tmux-session-name';
import type { MultiplexerBackend } from './types';

export const tmuxBackend: MultiplexerBackend = {
  id: 'tmux',
  makeSessionName: makeTmuxSessionName,
  buildAttachShellLine: buildTmuxShellLine,
  killSession: killTmuxSession,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/main/core/pty/multiplexer/tmux.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/pty/multiplexer/types.ts src/main/core/pty/multiplexer/tmux.ts src/main/core/pty/multiplexer/tmux.test.ts
git commit -m "feat(pty): add multiplexer backend interface + tmux backend"
```

---

### Task 2: boo backend

Use the **spike-confirmed** idiom from Task 0. The code below encodes the spec §7.2 candidate; if Task 0 found a different idiom (e.g. an `boo ls` guard), substitute it in Step 3 and the matching assertion in Step 1.

**Files:**
- Create: `src/main/core/pty/multiplexer/boo.ts`
- Test: `src/main/core/pty/multiplexer/boo.test.ts`

**Interfaces:**
- Consumes: `MultiplexerBackend` from `./types`; `IExecutionContext`.
- Produces: `const booBackend: MultiplexerBackend`.

- [ ] **Step 1: Write the failing test**

Create `src/main/core/pty/multiplexer/boo.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { booBackend } from './boo';

describe('booBackend', () => {
  it('has id "boo"', () => {
    expect(booBackend.id).toBe('boo');
  });

  it('makeSessionName matches the emdash-<base64url> scheme', () => {
    expect(booBackend.makeSessionName('p:t:c')).toBe(
      `emdash-${Buffer.from('p:t:c', 'utf8').toString('base64url')}`
    );
  });

  it('buildAttachShellLine creates-if-missing then execs attach', () => {
    const line = booBackend.buildAttachShellLine('agent-session', 'exec /bin/zsh -il');
    expect(line).toMatch(/^\/bin\/sh -c /);
    // quoteShellArg single-quotes the inner args, then the outer `/bin/sh -c` wrapper
    // single-quotes the whole script — so assert on the boo-syntax literals (which carry no
    // single quotes and survive the outer escaping), not on the quoted session name.
    expect(line).toContain('boo new ');
    expect(line).toContain('-d -- /bin/sh -c ');
    expect(line).toContain('; exec boo attach ');
    expect(line).toContain('2>/dev/null');
  });

  it('killSession runs `boo kill <name>` and swallows errors', async () => {
    const ctx = { exec: vi.fn().mockRejectedValue(new Error('gone')) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await booBackend.killSession(ctx as any, 'agent-session');
    expect(ctx.exec).toHaveBeenCalledWith('boo', ['kill', 'agent-session']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/pty/multiplexer/boo.test.ts`
Expected: FAIL — cannot resolve `./boo`.

- [ ] **Step 3: Write the boo backend**

Create `src/main/core/pty/multiplexer/boo.ts`:
```ts
import { log } from '@main/lib/logger';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { MultiplexerBackend } from './types';

const BOO_SESSION_PREFIX = 'emdash-';

export const booBackend: MultiplexerBackend = {
  id: 'boo',
  makeSessionName(sessionId: string): string {
    return `${BOO_SESSION_PREFIX}${Buffer.from(sessionId, 'utf8').toString('base64url')}`;
  },
  buildAttachShellLine(sessionName: string, commandLine: string): string {
    // Security: single-quote every interpolated value with quoteShellArg — never
    // JSON.stringify, whose double-quote semantics leave $, backticks, and globs active.
    const name = quoteShellArg(sessionName);
    const cmd = quoteShellArg(commandLine);
    // Create detached if missing (ignore "already exists"), then attach. `exec` makes the
    // pty become the boo client. The outer `/bin/sh -c` forces POSIX semantics for the
    // `;`/`2>/dev/null` regardless of the user's login shell. boo's VT is UTF-8 native.
    const script = `boo new ${name} -d -- /bin/sh -c ${cmd} 2>/dev/null; exec boo attach ${name}`;
    return `/bin/sh -c ${quoteShellArg(script)}`;
  },
  async killSession(ctx: IExecutionContext, sessionName: string): Promise<void> {
    try {
      await ctx.exec('boo', ['kill', sessionName]);
    } catch (err) {
      log.debug('booBackend.killSession: session not found or already dead', {
        sessionName,
        error: String(err),
      });
    }
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/main/core/pty/multiplexer/boo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/pty/multiplexer/boo.ts src/main/core/pty/multiplexer/boo.test.ts
git commit -m "feat(pty): add boo multiplexer backend"
```

---

### Task 3: Backend selection + module index

**Files:**
- Create: `src/main/core/pty/multiplexer/select.ts`
- Create: `src/main/core/pty/multiplexer/index.ts`
- Test: `src/main/core/pty/multiplexer/select.test.ts`

**Interfaces:**
- Consumes: `tmuxBackend`, `booBackend`, `MultiplexerBackend`, `MultiplexerId`, `SessionKind`.
- Produces:
  - `interface DetectedMultiplexers { boo: boolean; tmux: boolean }`
  - `function backendFor(id: MultiplexerId): MultiplexerBackend`
  - `function selectMultiplexer(kind: SessionKind, detected: DetectedMultiplexers, override?: MultiplexerId): MultiplexerBackend | null`
  - `index.ts` re-exports all of `types`, `tmux`, `boo`, `select`, `cleanup`.

- [ ] **Step 1: Write the failing test**

Create `src/main/core/pty/multiplexer/select.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { selectMultiplexer } from './select';

const BOTH = { boo: true, tmux: true };

describe('selectMultiplexer', () => {
  it('prefers boo for agent sessions when detected', () => {
    expect(selectMultiplexer('agent', BOTH)?.id).toBe('boo');
    expect(selectMultiplexer('agent', { boo: false, tmux: true })?.id).toBe('tmux');
    expect(selectMultiplexer('agent', { boo: false, tmux: false })).toBeNull();
  });

  it('uses tmux only for terminal sessions and ignores override', () => {
    expect(selectMultiplexer('terminal', BOTH)?.id).toBe('tmux');
    expect(selectMultiplexer('terminal', BOTH, 'boo')?.id).toBe('tmux');
    expect(selectMultiplexer('terminal', { boo: true, tmux: false })).toBeNull();
  });

  it('honors the agent override when the requested backend is detected', () => {
    expect(selectMultiplexer('agent', BOTH, 'tmux')?.id).toBe('tmux');
    expect(selectMultiplexer('agent', BOTH, 'boo')?.id).toBe('boo');
  });

  it('falls through normal agent selection when the override is not detected', () => {
    expect(selectMultiplexer('agent', { boo: true, tmux: false }, 'tmux')?.id).toBe('boo');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/pty/multiplexer/select.test.ts`
Expected: FAIL — cannot resolve `./select`.

- [ ] **Step 3: Write the selection logic and index**

Create `src/main/core/pty/multiplexer/select.ts`:
```ts
import { log } from '@main/lib/logger';
import { booBackend } from './boo';
import { tmuxBackend } from './tmux';
import type { MultiplexerBackend, MultiplexerId, SessionKind } from './types';

export interface DetectedMultiplexers {
  boo: boolean;
  tmux: boolean;
}

const BACKENDS: Record<MultiplexerId, MultiplexerBackend> = {
  tmux: tmuxBackend,
  boo: booBackend,
};

export function backendFor(id: MultiplexerId): MultiplexerBackend {
  return BACKENDS[id];
}

/** Returns the backend to use, or null = no persistence (spawn the bare command + warn). */
export function selectMultiplexer(
  kind: SessionKind,
  detected: DetectedMultiplexers,
  override?: MultiplexerId
): MultiplexerBackend | null {
  if (kind === 'agent') {
    // EMDASH_AGENT_MULTIPLEXER forces a backend when detected; else warn + fall through.
    // Gated to agent sessions so terminals are never affected.
    if (override) {
      if (detected[override]) return BACKENDS[override];
      log.warn(
        `EMDASH_AGENT_MULTIPLEXER=${override} set but not detected; using normal selection`
      );
    }
    if (detected.boo) return booBackend;
    if (detected.tmux) return tmuxBackend;
    return null;
  }
  // terminals: tmux only, override ignored
  return detected.tmux ? tmuxBackend : null;
}
```

Create `src/main/core/pty/multiplexer/index.ts`:
```ts
export * from './types';
export * from './tmux';
export * from './boo';
export * from './select';
export * from './cleanup';
```

> Note: `index.ts` re-exports `./cleanup`, created in Task 7. If you run typecheck between tasks, temporarily omit that line until Task 7 lands.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/main/core/pty/multiplexer/select.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/pty/multiplexer/select.ts src/main/core/pty/multiplexer/index.ts src/main/core/pty/multiplexer/select.test.ts
git commit -m "feat(pty): add multiplexer backend selection"
```

---

### Task 4: Detect boo + tmux as core dependencies

Registers boo (managed, category `core`) and tmux (detection-only) so `selectMultiplexer` has real availability data, locally and per SSH connection. Reuses the existing `HostDependencyManager` (`dependencies/dependency-managers.ts`) and `registry.ts`.

**Files:**
- Create: `src/main/core/dependencies/core-deps/descriptors.ts`
- Modify: `src/main/core/dependencies/registry.ts` (merge core descriptors into `DEPENDENCIES`)
- Modify: `src/main/core/dependencies/dependency-managers.ts` (BYOI-safe host resolution — prefer `getProxy` over `connect`, Step 6a)
- Create: `src/main/core/dependencies/core-deps/detect-multiplexers.ts`
- Test: `src/main/core/dependencies/core-deps/descriptors.test.ts`

**Interfaces:**
- Consumes: `DependencyDescriptor`, `ProbeResult` from the shared runtime; `getDependencyManager` from `dependencies/dependency-managers`; `DetectedMultiplexers` from the multiplexer module.
- Produces:
  - `const CORE_DEPENDENCIES: DependencyDescriptor[]` (boo, tmux)
  - `function detectMultiplexers(connectionId?: string): Promise<DetectedMultiplexers>`

- [ ] **Step 1: Confirm the dependency types need no change**

In `packages/shared/src/host-dependencies/runtime/types.ts`, confirm `DependencyId = string` (so `'boo'`/`'tmux'` are valid ids with no edit) and `DependencyCategory = 'core' | 'agent'`. Use the existing **`'core'`** category — do **not** add `'tool'`. No type changes required.

- [ ] **Step 2: Write the failing descriptor test**

Create `src/main/core/dependencies/core-deps/descriptors.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CORE_DEPENDENCIES } from './descriptors';

describe('CORE_DEPENDENCIES', () => {
  it('registers boo as a managed core dependency with an installer', () => {
    const boo = CORE_DEPENDENCIES.find((d) => d.id === 'boo');
    expect(boo).toBeDefined();
    expect(boo?.category).toBe('core');
    expect(boo?.commands).toContain('boo');
    expect(boo?.installCommands?.macos?.[0]?.method).toBe('curl');
  });

  it('registers tmux as a detection-only core dependency (no install commands)', () => {
    const tmux = CORE_DEPENDENCIES.find((d) => d.id === 'tmux');
    expect(tmux?.category).toBe('core');
    expect(tmux?.versionArgs).toEqual(['-V']);
    expect(tmux?.installCommands).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/dependencies/core-deps/descriptors.test.ts`
Expected: FAIL — cannot resolve `./descriptors`.

- [ ] **Step 4: Write the descriptors**

Create `src/main/core/dependencies/core-deps/descriptors.ts`:
```ts
import type { DependencyDescriptor } from '@emdash/shared/deps/runtime';

const BOO_INSTALL = {
  method: 'curl' as const,
  command: 'curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh',
  label: 'Official installer',
  recommended: true,
};

const boo: DependencyDescriptor = {
  id: 'boo',
  name: 'boo',
  category: 'core',
  commands: ['boo'],
  versionArgs: ['--version'],
  docUrl: 'https://github.com/coder/boo',
  // boo ships macOS + Linux installers only (no Windows).
  installCommands: { macos: [BOO_INSTALL], linux: [BOO_INSTALL] },
};

const tmux: DependencyDescriptor = {
  id: 'tmux',
  name: 'tmux',
  category: 'core',
  commands: ['tmux'],
  versionArgs: ['-V'],
  // Detection-only (spec §14 Q4): no installCommands.
};

export const CORE_DEPENDENCIES: DependencyDescriptor[] = [boo, tmux];
```

> Verified shapes: import alias is `@emdash/shared/deps/runtime` (package export), `DependencyCategory` is `'core' | 'agent'`, and `InstallOption` is `{ method: InstallMethod; command: string; label?; recommended?; … }` (`packages/shared/src/host-dependencies/capability.ts`). `command` is a full shell string, so the `| sh` pipe is valid, and `'curl'` is a member of `InstallMethod`.

- [ ] **Step 5: Merge core deps into the registry**

In `src/main/core/dependencies/registry.ts`, import `CORE_DEPENDENCIES` and append it to `DEPENDENCIES`:
```ts
import { CORE_DEPENDENCIES } from './core-deps/descriptors';
// …
export const DEPENDENCIES: DependencyDescriptor[] = [
  ...buildAgentDependencies(),
  ...CORE_DEPENDENCIES,
];
```

- [ ] **Step 6: Make `getDependencyManager` BYOI-safe, then write `detectMultiplexers`**

**6a — BYOI-safe host resolution.** In `src/main/core/dependencies/dependency-managers.ts`, `getDependencyManager(connectionId)` currently does `const proxy = await sshConnectionManager.connect(connectionId);`. That breaks for BYOI: BYOI hosts are ephemeral `task:<id>` proxies created via `connectFromConfig` with **no persisted `ssh_connections` row**, so `connect()` either throws (no row, when not pooled) or mutates intentional-disconnect semantics (it calls `intentionalDisconnects.delete(id)`). Prefer the live proxy:
```ts
const proxy =
  sshConnectionManager.getProxy(connectionId) ?? (await sshConnectionManager.connect(connectionId));
```
`getProxy(connectionId)` returns the already-open proxy when one exists — always true for a BYOI host during its active task's bootstrap, and for project-SSH once connected — without reconnecting or clearing flags; the `connect()` fallback covers a persisted connection not yet open. (This same path makes the Task 9 remote install BYOI-safe.) Add a focused test that `getDependencyManager` calls `getProxy` and does not call `connect` when a proxy is already pooled.

**6b — detectMultiplexers.** Create `src/main/core/dependencies/core-deps/detect-multiplexers.ts`:
```ts
import { getDependencyManager } from '@main/core/dependencies/dependency-managers';
import type { DetectedMultiplexers } from '@main/core/pty/multiplexer';

/**
 * Probe boo + tmux availability on the given host (local when no connectionId).
 * `probe()` performs the real detection; `get()` is only a cache read and a fresh SSH manager
 * starts empty — so we MUST probe, or fresh remote workspaces report everything missing.
 */
export async function detectMultiplexers(connectionId?: string): Promise<DetectedMultiplexers> {
  const mgr = await getDependencyManager(connectionId);
  const [boo, tmux] = await Promise.all([mgr.probe('boo'), mgr.probe('tmux')]);
  return { boo: boo.status === 'available', tmux: tmux.status === 'available' };
}
```

> `HostDependencyManager.probe(id): Promise<DependencyState>` (`host-dependency-manager.ts:241`) returns a state whose `.status` is `'available' | 'missing' | 'error'`; `get()` (line 214) is a non-awaiting cache read — don't use it here. The 6a change is what makes this (and remote install) safe for BYOI.

- [ ] **Step 7: Run the descriptor test to verify it passes**

Run: `pnpm vitest run src/main/core/dependencies/core-deps/descriptors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm run typecheck`
Expected: no errors (`'core'` category and string `DependencyId` need no type changes).
```bash
git add src/main/core/dependencies/core-deps/ src/main/core/dependencies/registry.ts src/main/core/dependencies/dependency-managers.ts
git commit -m "feat(deps): register boo + tmux as core deps; BYOI-safe host resolution"
```

---

### Task 5: Backend identity in the spawn wrappers

Replace the ephemeral `tmuxSessionName?: string` (read directly by the wrappers) with `multiplexer?: { id, sessionName }`, and dispatch via `backendFor`. **No migration** — these configs are computed per spawn.

**Files:**
- Modify: `src/shared/core/agents/agent-session.ts`, `src/shared/core/terminals/general-session.ts`
- Modify: `src/main/core/pty/spawn-utils.ts` (`posixShellLineForSsh`)
- Modify: `src/main/core/pty/pty-spawn-platform.ts` (`resolveLocalPtySpawn` and the spawn `intent` type)
- Test: `src/main/core/pty/spawn-utils.test.ts`

**Interfaces:**
- Consumes: `MultiplexerId`, `backendFor` from `@main/core/pty/multiplexer`.
- Produces: session configs / spawn intent carry `multiplexer?: { id: MultiplexerId; sessionName: string }` instead of `tmuxSessionName`.

- [ ] **Step 1: Write the failing test**

Create `src/main/core/pty/spawn-utils.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveSshCommand } from './spawn-utils';
import type { AgentSessionConfig } from '@shared/core/agents/agent-session';

const base: AgentSessionConfig = {
  taskId: 't',
  conversationId: 'c',
  providerId: 'claude' as AgentSessionConfig['providerId'],
  command: 'claude',
  args: [],
  cwd: '/work',
  autoApprove: false,
  resume: false,
};

describe('resolveSshCommand multiplexer wrapping', () => {
  it('wraps with the tmux backend when multiplexer.id is tmux', () => {
    const cmd = resolveSshCommand('agent', { ...base, multiplexer: { id: 'tmux', sessionName: 's' } });
    expect(cmd).toContain('tmux -u attach-session -t \\"s\\"');
  });

  it('wraps with the boo backend when multiplexer.id is boo', () => {
    const cmd = resolveSshCommand('agent', { ...base, multiplexer: { id: 'boo', sessionName: 's' } });
    expect(cmd).toContain('exec boo attach \\"s\\"');
  });

  it('does not wrap when multiplexer is absent', () => {
    const cmd = resolveSshCommand('agent', base);
    expect(cmd).not.toContain('attach');
  });
});
```

Also add local-spawn coverage in `src/main/core/pty/pty-spawn-platform.test.ts` via `resolveLocalPtySpawn` (exported; used by `local-conversation.ts`): a **run-command** intent with `multiplexer: { id: 'boo', sessionName: 's' }` wraps with `exec boo attach`; an **interactive-shell** intent with `multiplexer: { id: 'tmux', sessionName: 's' }` wraps with `tmux -u attach-session`; and a **Windows** shell profile with a `multiplexer` set still produces the `tmux_unsupported_on_windows` warning. Mirror the `intent` construction from the existing `pty-spawn-platform` tests, or from the `resolveLocalPtySpawn(...)` call site in `local-conversation.ts`, for the required fields.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/pty/spawn-utils.test.ts`
Expected: FAIL — `multiplexer` is not a known property of `AgentSessionConfig`.

- [ ] **Step 3: Update the session-config types**

In `src/shared/core/agents/agent-session.ts`, replace `tmuxSessionName?: string;` with:
```ts
  multiplexer?: { id: 'tmux' | 'boo'; sessionName: string };
```
Do the same in `src/shared/core/terminals/general-session.ts`. (Keep the literal union here to avoid a shared→main import cycle; it equals `MultiplexerId`.)

- [ ] **Step 4: Update the SSH wrapper**

In `src/main/core/pty/spawn-utils.ts`, replace the `import { buildTmuxShellLine } from './tmux-session-name';` with `import { backendFor } from './multiplexer';`, and in both `case 'agent'` and `case 'general'` branches of `posixShellLineForSsh`, replace:
```ts
        line: cfg.tmuxSessionName ? buildTmuxShellLine(cfg.tmuxSessionName, line) : line,
```
with:
```ts
        line: cfg.multiplexer
          ? backendFor(cfg.multiplexer.id).buildAttachShellLine(cfg.multiplexer.sessionName, line)
          : line,
```

- [ ] **Step 5: Update ALL local-spawn branches**

In `src/main/core/pty/pty-spawn-platform.ts`, replace `import { buildTmuxShellLine } from './tmux-session-name';` with `import { backendFor } from './multiplexer';`, change the `PtySpawnIntent` type's `tmuxSessionName?: string` to `multiplexer?: { id: 'tmux' | 'boo'; sessionName: string }`, and update **all three** readers (there is more than one — grep the file for `tmuxSessionName` and leave none):

(a) `windowsWarnings` (~line 195) — persistence is unsupported on Windows for either backend, keep the existing warning constant:
```ts
  if (intent.multiplexer) warnings.push('tmux_unsupported_on_windows');
```

(b) the **interactive-shell** branch in `resolvePosixSpawn` (~line 353):
```ts
    if (intent.multiplexer) {
      const commandLine = intent.shellSetup
        ? `${intent.shellSetup} && exec ${quotePosixArg(shell)} ${interactiveArgs.join(' ')}`
        : `exec ${quotePosixArg(shell)} ${interactiveArgs.join(' ')}`;
      return {
        command: shell,
        args: [
          ...(intent.shellSetup ? setupWrapperArgs : commandArgs),
          backendFor(intent.multiplexer.id).buildAttachShellLine(
            intent.multiplexer.sessionName,
            commandLine
          ),
        ],
        cwd: intent.cwd,
        warnings: [],
      };
    }
```

(c) the **run-command** branch (~line 401):
```ts
  if (intent.multiplexer) {
    return {
      command: shell,
      args: [
        ...commandArgs,
        backendFor(intent.multiplexer.id).buildAttachShellLine(
          intent.multiplexer.sessionName,
          fullCommandLine
        ),
      ],
      cwd: intent.cwd,
      warnings: [],
    };
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/main/core/pty/spawn-utils.test.ts`
Expected: PASS (the SSH + local + Windows cases above). (Compilation may surface other readers of `tmuxSessionName` — those are updated in Task 6; if typecheck fails here, proceed to Task 6 before the full gate.)

- [ ] **Step 7: Commit**

```bash
git add src/shared/core/agents/agent-session.ts src/shared/core/terminals/general-session.ts src/main/core/pty/spawn-utils.ts src/main/core/pty/pty-spawn-platform.ts src/main/core/pty/spawn-utils.test.ts
git commit -m "feat(pty): route spawn wrappers through multiplexer backend identity"
```

---

### Task 6: Provider integration + backend selection wiring

Swap `tmux: boolean` for `multiplexer: MultiplexerBackend | null` across the four providers, set `config.multiplexer` at spawn, change persistence branches to `if (this.multiplexer)`, and select the backend in the workspace/conversation builders.

**Files:**
- Modify: `src/main/core/conversations/impl/local-conversation.ts`, `src/main/core/conversations/impl/ssh-conversation.ts`
- Modify: `src/main/core/terminals/impl/local-terminal-provider.ts`, `src/main/core/terminals/impl/ssh-terminal-provider.ts`
- Modify: `src/main/core/workspaces/workspace-factory.ts` and the conversation-provider builder (search for `new LocalConversationProvider(` / `new SshConversationProvider(`)
- Test: `src/main/core/conversations/impl/local-conversation.multiplexer.test.ts`

**Interfaces:**
- Consumes: `MultiplexerBackend`, `selectMultiplexer`, `detectMultiplexers`.
- Produces: each provider constructor takes `multiplexer?: MultiplexerBackend | null` (replacing `tmux?: boolean`); spawn sets `config.multiplexer = this.multiplexer ? { id: this.multiplexer.id, sessionName: this.multiplexer.makeSessionName(sessionId) } : undefined`.

- [ ] **Step 1: Write the failing test (respawn suppression keys off persistence, not tmux)**

Create `src/main/core/conversations/impl/local-conversation.multiplexer.test.ts`. Mirror the existing conversation/provider test setup (open the directory for an existing `*.test.ts` to copy the harness). Assert: when constructed with `multiplexer: tmuxBackend`, an unexpected child exit does **not** respawn; with `multiplexer: null` it does. Use the real `tmuxBackend` import and the provider's public surface; stub the pty as the existing tests do.

> If no provider unit test exists to mirror, make this a focused test of the decision predicate: extract the "should respawn" condition into a tiny pure helper `shouldRespawn(multiplexer: MultiplexerBackend | null, …)` and test that helper directly. Keep the helper in `local-conversation.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/conversations/impl/local-conversation.multiplexer.test.ts`
Expected: FAIL — constructor still expects `tmux`.

- [ ] **Step 3: Update `LocalConversationProvider`**

In `src/main/core/conversations/impl/local-conversation.ts`:
- Replace `import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';` with `import type { MultiplexerBackend } from '@main/core/pty/multiplexer';`.
- Replace the field `private readonly tmux: boolean;` with `private readonly multiplexer: MultiplexerBackend | null;`.
- Replace the constructor param `tmux = false` (and its type `tmux?: boolean;`) with `multiplexer = null` / `multiplexer?: MultiplexerBackend | null;`, and `this.tmux = tmux;` with `this.multiplexer = multiplexer;`.
- At spawn, where it previously set `tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined`, set:
```ts
      multiplexer: this.multiplexer
        ? { id: this.multiplexer.id, sessionName: this.multiplexer.makeSessionName(sessionId) }
        : undefined,
```
- Replace every `if (this.tmux)` with `if (this.multiplexer)` and every `if (… && !this.tmux)` with `if (… && !this.multiplexer)`.
- Replace the delete-time `killTmuxSession(this.ctx, makeTmuxSessionName(sessionId))` with `await this.multiplexer?.killSession(this.ctx, this.multiplexer.makeSessionName(sessionId))`.

- [ ] **Step 4: Apply the same change to the other three providers**

Repeat Step 3's pattern in `ssh-conversation.ts`, `local-terminal-provider.ts`, `ssh-terminal-provider.ts` (the terminal providers will be passed the tmux backend by the selector, so their behavior is unchanged). Keep `ssh-terminal-provider.rehydrate()` working — it now calls `this.multiplexer`-derived names.

- [ ] **Step 5: Wire selection in the builders**

In `src/main/core/workspaces/workspace-factory.ts`, replace `const tmuxEnabled = projectSettings.tmux ?? false;` with a backend resolution that respects the persistence toggle, detection, and the escape hatch:
```ts
import { selectMultiplexer } from '@main/core/pty/multiplexer';
import { detectMultiplexers } from '@main/core/dependencies/core-deps/detect-multiplexers';
// …
const persistenceOn = projectSettings.tmux ?? false;
const connectionId = type.kind === 'ssh' ? type.connectionId : undefined;
const detected = persistenceOn ? await detectMultiplexers(connectionId) : { boo: false, tmux: false };
const overrideEnv = process.env.EMDASH_AGENT_MULTIPLEXER;
const override = overrideEnv === 'tmux' || overrideEnv === 'boo' ? overrideEnv : undefined;
const agentMultiplexer = persistenceOn ? selectMultiplexer('agent', detected, override) : null;
const terminalMultiplexer = persistenceOn ? selectMultiplexer('terminal', detected) : null;
```
Pass `multiplexer: terminalMultiplexer` into the `SshTerminalProvider`/`LocalTerminalProvider` constructions (replacing `tmux: tmuxEnabled`). In the conversation-provider builder (`new LocalConversationProvider(` / `new SshConversationProvider(`), pass `multiplexer: agentMultiplexer` (replacing `tmux: tmuxEnabled`).

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm vitest run src/main/core/conversations/impl/local-conversation.multiplexer.test.ts && pnpm run typecheck`
Expected: test PASS; typecheck clean (all `tmux:`/`tmuxSessionName` readers updated).

- [ ] **Step 7: Commit**

```bash
git add src/main/core/conversations/impl/ src/main/core/terminals/impl/ src/main/core/workspaces/workspace-factory.ts
git commit -m "feat(sessions): select boo/tmux backend per host and session kind"
```

---

### Task 7: Backend- and host-aware orphan cleanup

Replace the two provider-less cleanup paths that hard-code tmux with a helper that kills **both** backend names (agent ids) on the **session host** (BYOI proxy when applicable).

**Files:**
- Create: `src/main/core/pty/multiplexer/cleanup.ts`
- Test: `src/main/core/pty/multiplexer/cleanup.test.ts`
- Modify: `src/main/core/conversations/deleteConversation.ts`, `src/main/core/tasks/task-session-manager.ts`, `src/main/core/tasks/task-service.ts`

**Interfaces:**
- Consumes: `tmuxBackend`, `booBackend`, `IExecutionContext`, `SessionKind`.
- Produces: `function killSessionById(opts: { hostCtx: IExecutionContext; kind: SessionKind; sessionId: string }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/main/core/pty/multiplexer/cleanup.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { killSessionById } from './cleanup';

function fakeCtx() {
  return { exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }) };
}

describe('killSessionById', () => {
  it('kills both tmux and boo names for an agent/conversation id', async () => {
    const ctx = fakeCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await killSessionById({ hostCtx: ctx as any, kind: 'agent', sessionId: 'p:t:c' });
    const calls = ctx.exec.mock.calls.map((c) => c[0]);
    expect(calls).toContain('tmux');
    expect(calls).toContain('boo');
  });

  it('kills only tmux for a terminal id', async () => {
    const ctx = fakeCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await killSessionById({ hostCtx: ctx as any, kind: 'terminal', sessionId: 'p:t:term' });
    const cmds = ctx.exec.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual(['tmux']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/pty/multiplexer/cleanup.test.ts`
Expected: FAIL — cannot resolve `./cleanup`.

- [ ] **Step 3: Write the cleanup helper**

Create `src/main/core/pty/multiplexer/cleanup.ts`:
```ts
import type { IExecutionContext } from '@main/core/execution-context/types';
import { booBackend } from './boo';
import { tmuxBackend } from './tmux';
import type { SessionKind } from './types';

/**
 * Kill an orphaned session whose backend id is no longer known. Agent ids may be
 * tmux- or boo-backed, so we kill both deterministic names (idempotent / no-op when
 * absent). Terminal ids are tmux-only. Runs on the resolved session host ctx.
 */
export async function killSessionById(opts: {
  hostCtx: IExecutionContext;
  kind: SessionKind;
  sessionId: string;
}): Promise<void> {
  const { hostCtx, kind, sessionId } = opts;
  const backends = kind === 'agent' ? [tmuxBackend, booBackend] : [tmuxBackend];
  await Promise.all(
    backends.map((b) => b.killSession(hostCtx, b.makeSessionName(sessionId)))
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/main/core/pty/multiplexer/cleanup.test.ts`
Expected: PASS (2 tests). Re-add the `export * from './cleanup';` line in `index.ts` if you removed it in Task 3.

- [ ] **Step 5: Update `deleteConversation.ts`**

In `src/main/core/conversations/deleteConversation.ts`, replace the import of `killTmuxSession, makeTmuxSessionName` with `import { killSessionById } from '@main/core/pty/multiplexer';`, and replace the `else { … killTmuxSession(...) }` block with a host-resolved call:
```ts
    } else {
      const project = projectManager.getProject(projectId);
      if (project) {
        await killSessionById({
          hostCtx: project.ctx,
          kind: 'agent',
          sessionId: makePtySessionId(projectId, taskId, conversationId),
        });
      }
    }
```
> `project.ctx` is correct for local + project-SSH. For a **detached BYOI** task whose proxy has closed this is best-effort (spec §7.8 / §14 Q8): the kill no-ops and the session is reaped by the sandbox's later `terminate`. Do not attempt a provision re-run here.

- [ ] **Step 6: Update `cleanupDetachedSessions` + store the session host ctx**

In `src/main/core/tasks/task-session-manager.ts`, replace the import and the `Promise.all(... killTmuxSession ...)` in `cleanupDetachedSessions` with per-id `killSessionById`, using the **session host ctx** (see below) and `kind` derived from whether the leaf id is a conversation or terminal:
```ts
import { killSessionById } from '@main/core/pty/multiplexer';
// …
const { conversationIds, terminalIds } = await getTaskSessionLeafIds(projectId, taskId);
await Promise.all([
  ...conversationIds.map((leafId) =>
    killSessionById({ hostCtx: ctx, kind: 'agent', sessionId: makePtySessionId(projectId, taskId, leafId) })
  ),
  ...terminalIds.map((leafId) =>
    killSessionById({ hostCtx: ctx, kind: 'terminal', sessionId: makePtySessionId(projectId, taskId, leafId) })
  ),
]);
```
In `src/main/core/tasks/task-service.ts`, change the `registerTask(taskId, data, task.projectId, project.ctx)` call (around line 137) to pass the **session host ctx**: for a BYOI task use the live task SSH proxy ctx surfaced by the bootstrap result (`data.sshConnectionId` resolved to its `SshExecutionContext`, kept alive while registered); otherwise `project.ctx`. Add a small resolver next to the call:
```ts
const liveProxy = data.sshConnectionId
  ? sshConnectionManager.getProxy(data.sshConnectionId)
  : undefined;
const sessionHostCtx = liveProxy ? new SshExecutionContext(liveProxy) : project.ctx;
await taskSessionManager.registerTask(taskId, data, task.projectId, sessionHostCtx);
```
> `sshConnectionManager.getProxy(id): SshClientProxy | undefined` (`ssh-connection-manager.ts:179`) returns the **live** proxy — correct for BYOI, whose connection is the ephemeral `task:<taskId>` created by `connectFromConfig` (`workspaces/byoi/provision-byoi-task.ts`) with **no** persisted row to `connect(id)` against. When the proxy is gone (detached BYOI after restart) `getProxy` returns `undefined` → fall back to `project.ctx` and accept best-effort cleanup (§7.8). For full robustness you may instead thread the live proxy/ctx through `WorkspaceBootstrapResult`; `getProxy` is the lighter fix.

- [ ] **Step 7: Typecheck, test, commit**

Run: `pnpm run typecheck && pnpm vitest run src/main/core/pty/multiplexer/cleanup.test.ts`
Expected: clean + PASS.
```bash
git add src/main/core/pty/multiplexer/cleanup.ts src/main/core/pty/multiplexer/cleanup.test.ts src/main/core/pty/multiplexer/index.ts src/main/core/conversations/deleteConversation.ts src/main/core/tasks/task-session-manager.ts src/main/core/tasks/task-service.ts
git commit -m "feat(sessions): backend- and host-aware orphan session cleanup"
```

---

### Task 8: Settings UI relabel + active-backend hint

**Files:**
- Modify: `src/renderer/features/settings/components/TaskSettingsRows.tsx`

**Interfaces:**
- Consumes: the existing `tmux`/`tmuxByDefault` setting row state (unchanged) and the core-deps status RPC from Task 9 (for the boo install hint). If Task 9 is deferred, ship the relabel alone and add the hint when Task 9 lands.

- [ ] **Step 1: Relabel the toggle**

In `TaskSettingsRows.tsx`, change the row label "Enable tmux" → "Persistent sessions" and its description to explain that sessions survive disconnects (backend chosen automatically: boo for agents when available, else tmux). Keep the bound setting key (`tmux`) unchanged.

- [ ] **Step 2: Add the active-backend / install hint**

When the toggle is on, render a small status line: the active agent backend (from the Task 9 status RPC: boo vs tmux), and — when boo is missing — an "Install boo" affordance that calls the Task 9 install action. Match the existing row/secondary-text components in this file.

- [ ] **Step 3: Verify in the running app**

Run (from `apps/emdash-desktop/`): `pnpm run dev`, open Settings → task settings, confirm the relabel and (with boo absent) the install hint render. Capture the existing renderer test pattern under `src/renderer/tests/` if a unit test fits; otherwise this is manual.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/features/settings/components/TaskSettingsRows.tsx
git commit -m "feat(settings): relabel persistence toggle + show active multiplexer backend"
```

---

### Task 9: Core-deps RPC (sibling controller) + consented boo install

Per §14 Q3, expose core-dependency status/install through a **separate** controller rather than overloading the agent-shaped RPC.

**Files:**
- Create: `src/main/core/dependencies/core-deps/controller.ts`
- Modify: `src/main/rpc.ts` (register the controller)
- Modify: `src/renderer/lib/ipc.ts` consumers (call the new RPC from Task 8's hint)
- Test: `src/main/core/dependencies/core-deps/controller.test.ts`

**Interfaces:**
- Produces RPC methods (mirror the shapes in `agents/controller.ts` `getAgentInstallationStatus` / `install`):
  - `getCoreDependencyStatus(id: 'boo' | 'tmux', connectionId?: string): Promise<{ status: DependencyStatus }>`
  - `installCoreDependency(id: 'boo', connectionId?: string): Promise<DependencyInstallResult>` (the manager's result; has `.success`)

- [ ] **Step 1: Write the failing controller test**

Create `src/main/core/dependencies/core-deps/controller.test.ts` asserting `getCoreDependencyStatus('boo')` returns the manager's status and `installCoreDependency('boo')` delegates to `mgr.install('boo')`. Mock `getDependencyManager` to return a stub with `get`/`install` (mirror how `agents/controller.ts` is exercised — search the repo for an existing controller test to copy the mocking style).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/core/dependencies/core-deps/controller.test.ts`
Expected: FAIL — cannot resolve `./controller`.

- [ ] **Step 3: Implement the controller**

Create `src/main/core/dependencies/core-deps/controller.ts`, mirroring `agents/controller.ts` install/status methods but typed to the core ids:
```ts
import { getDependencyManager } from '@main/core/dependencies/dependency-managers';

export const coreDepsController = {
  getCoreDependencyStatus: async (id: 'boo' | 'tmux', connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    const state = await mgr.probe(id); // probe(), not get() — same empty-cache bug as Task 4
    return { status: state.status };
  },
  installCoreDependency: async (id: 'boo', connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.install(id); // DependencyInstallResult (a Result with `.success`)
  },
};
```
> Public method names are `getCoreDependencyStatus` / `installCoreDependency` — used consistently in the Interfaces block, the test, and the renderer call. `mgr.probe(id)` returns `DependencyState`; `mgr.install(id)` returns `DependencyInstallResult`. The consented-install UX (§14 Q5) lives in the renderer (Task 8 hint → `installCoreDependency`); the install command comes from the boo descriptor's `installCommands` (Task 4).

- [ ] **Step 4: Register the controller**

In `src/main/rpc.ts`, register `coreDepsController` following the existing controller-registration pattern (copy how `agents` controller is wired). Expose it on the renderer `rpc` client.

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm vitest run src/main/core/dependencies/core-deps/controller.test.ts && pnpm run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/core/dependencies/core-deps/controller.ts src/main/rpc.ts src/renderer/lib/ipc.ts
git commit -m "feat(deps): core-deps RPC controller for boo status + consented install"
```

---

### Task 10: Integration smoke + merge gate

**Files:**
- Test: `src/main/core/pty/multiplexer/integration.test.ts` (detection-guarded)

- [ ] **Step 1: Write a detection-guarded integration test**

Create `src/main/core/pty/multiplexer/integration.test.ts` that `it.skipIf(!hasBoo)` (resolve `boo` on PATH at module load): create a boo agent session via `booBackend.buildAttachShellLine`, spawn it through a local pty, assert the child is alive after a simulated client detach, then `booBackend.killSession`. Mirror the integration-style pty tests already in `src/main/core/pty/` if present; otherwise keep it minimal (spawn `/bin/sh -c <line>`, assert `boo ls` lists the session, then kill).

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/main/core/pty/multiplexer/integration.test.ts`
Expected: PASS when boo is installed, SKIP otherwise.

- [ ] **Step 3: Full merge gate**

Run (from `apps/emdash-desktop/`): `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: all green.

- [ ] **Step 4: Manual verification (spec §10)**

With persistence ON: confirm a real agent renders correctly under boo (the motivation), survives disconnect→reattach, and that removing `boo` from `PATH` falls back to tmux. Repeat once over an SSH workspace.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/pty/multiplexer/integration.test.ts
git commit -m "test(pty): detection-guarded boo session integration smoke"
```

---

## Self-Review

**Spec coverage:** §7.1 backend interface → T1; §7.2 boo backend → T2; §7.3 selection + agent-only override → T3; §7.6 detection (boo managed + tmux detection-only) → T4; §7.4 backend identity to spawn wrappers + provider integration → T5/T6; §7.5 settings keep-keys/relabel + escape hatch → T6 (selection) / T8 (UI); §7.7 lifecycle → exercised by T2/T6; §7.8 backend- and host-aware cleanup incl. BYOI best-effort → T7; §7.6 core-dep RPC (sibling, §14 Q3) → T9; §9 spike → T0; §10 testing → per-task + T10. All sections map to a task.

**Placeholder scan:** No "TBD"/"add error handling"-style gaps. The few "confirm against the real signature" notes are deliberate verification anchors at the shared-runtime / BYOI-proxy boundaries this plan can't fully read; each names the exact file to check and the exact symbol to match.

**Type consistency:** `MultiplexerBackend` / `MultiplexerId` / `SessionKind` are defined in T1 and used unchanged in T3/T5/T7. `multiplexer?: { id; sessionName }` is introduced in T5 and consumed in T6. `selectMultiplexer(kind, detected, override?)` signature is identical in T3 and T6. `killSessionById({ hostCtx, kind, sessionId })` defined in T7 and called in T7's edits. `detectMultiplexers(connectionId?)` defined in T4, used in T6.
