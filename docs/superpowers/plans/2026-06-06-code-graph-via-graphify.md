# Code-Graph for Agents via Graphify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent a queryable code graph over its worktree, reachable as an MCP tool, by orchestrating the off-the-shelf Graphify CLI per worktree.

**Architecture:** A new main-process singleton `CodeGraphService` (mirroring `SearchService`) that (1) probes for `python`/`graphify` on the worktree host, (2) runs `graphify extract --update` on worktree create + git change (debounced, serialized), (3) writes a project-local `.mcp.json` registering Graphify's stdio MCP server scoped to that worktree, and (4) emits status to the renderer for a header pill + detail popover. We build no parser, no graph schema, and no MCP server of our own — Graphify supplies all three.

**Tech Stack:** TypeScript (Electron main + React renderer), Graphify (Python CLI, MIT), existing Rundash patterns: `createRPCController`, `IExecutionContext.exec`, `fsEvents`, `ws.git.on('status:updated')`, `defineEvent`, MobX `Resource`, `jsonc-parser`.

**Spec:** `docs/superpowers/specs/2026-06-06-code-graph-via-graphify-design.md`

---

## File Structure

**New files (main):**
- `src/shared/code-graph/types.ts` — shared types: `CodeGraphStatus`, `GraphProbeResult`.
- `src/shared/events/codeGraphEvents.ts` — typed event channel `codegraph:status`.
- `src/main/core/code-graph/code-graph-service.ts` — the singleton orchestrator.
- `src/main/core/code-graph/graphify-runner.ts` — thin wrapper around the graphify CLI (probe, extract, hook install).
- `src/main/core/code-graph/mcp-json-writer.ts` — non-destructive `.mcp.json` merge for a worktree.
- `src/main/core/code-graph/controller.ts` — RPC controller.
- Tests colocated: `*.test.ts` next to each of the above.

**New files (renderer):**
- `src/renderer/features/code-graph/code-graph-status-store.ts` — MobX `Resource` subscribing to the status event.
- `src/renderer/features/code-graph/CodeGraphStatusPill.tsx` — pill + detail popover.
- Test: `src/renderer/tests/code-graph-status.test.tsx` (browser project).

**Modified files:**
- `src/main/rpc.ts` — register `codeGraph` controller.
- `src/main/core/workspaces/workspace-factory.ts` — wire `onWorkspaceCreated`/`onWorkspaceDestroyed`.
- `packages/emdash-server/runner/Dockerfile` — bake in Python + graphify.
- The worktree header component that renders status (located in Task 16).

**Responsibility boundaries:** `graphify-runner.ts` is the ONLY file that knows graphify's CLI surface. `mcp-json-writer.ts` is the ONLY file that touches `.mcp.json`. `code-graph-service.ts` orchestrates and owns no I/O details. This keeps each unit independently testable.

---

## Task 1: Shared types

**Files:**
- Create: `src/shared/code-graph/types.ts`
- Test: `src/shared/code-graph/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { isGraphAvailable, type GraphProbeResult } from './types';

describe('isGraphAvailable', () => {
  it('returns true only when both python and graphify are present', () => {
    const ok: GraphProbeResult = { python: true, graphify: true };
    const noGraphify: GraphProbeResult = { python: true, graphify: false };
    const neither: GraphProbeResult = { python: false, graphify: false };
    expect(isGraphAvailable(ok)).toBe(true);
    expect(isGraphAvailable(noGraphify)).toBe(false);
    expect(isGraphAvailable(neither)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/shared/code-graph/types.test.ts`
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type CodeGraphState = 'unavailable' | 'building' | 'ready' | 'error';

export interface CodeGraphStatus {
  workspaceId: string;
  state: CodeGraphState;
  /** Populated when state === 'ready'. */
  symbolCount?: number;
  fileCount?: number;
  /** Unix ms of last successful extract. */
  indexedAt?: number;
  /** Whether the worktree's .mcp.json contains the graphify entry. */
  mcpRegistered?: boolean;
  /** Human-readable hint shown for 'unavailable'/'error'. */
  hint?: string;
}

export interface GraphProbeResult {
  python: boolean;
  graphify: boolean;
}

export function isGraphAvailable(probe: GraphProbeResult): boolean {
  return probe.python && probe.graphify;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/shared/code-graph/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/code-graph/types.ts src/shared/code-graph/types.test.ts
git commit -m "feat(code-graph): shared types and availability helper"
```

---

## Task 2: Status event channel

**Files:**
- Create: `src/shared/events/codeGraphEvents.ts`
- Test: `src/shared/events/codeGraphEvents.test.ts`

Mirror the existing pattern in `src/shared/events/gitEvents.ts` (uses `defineEvent`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { codeGraphStatusChannel } from './codeGraphEvents';

describe('codeGraphStatusChannel', () => {
  it('is defined with the codegraph:status channel name', () => {
    expect(codeGraphStatusChannel.channel).toBe('codegraph:status');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/shared/events/codeGraphEvents.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

First confirm the `defineEvent` shape by reading `src/shared/events/gitEvents.ts` and `src/shared/ipc/events.ts`. Then:

```typescript
import { defineEvent } from '@shared/ipc/events';
import type { CodeGraphStatus } from '@shared/code-graph/types';

export const codeGraphStatusChannel = defineEvent<CodeGraphStatus>('codegraph:status');
```

> Note: if `defineEvent` does not expose `.channel`, adjust the test in Step 1 to assert whatever identity field it does expose (read `gitEvents.ts` for the exact shape before writing the test).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/shared/events/codeGraphEvents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/events/codeGraphEvents.ts src/shared/events/codeGraphEvents.test.ts
git commit -m "feat(code-graph): typed status event channel"
```

---

## Task 3: GraphifyRunner — probe

**Files:**
- Create: `src/main/core/code-graph/graphify-runner.ts`
- Test: `src/main/core/code-graph/graphify-runner.test.ts`

`GraphifyRunner` wraps the CLI behind an injected `IExecutionContext` (see `src/main/core/execution-context/types.ts`) so it can run locally, over SSH, or be unit-tested with a fake context.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { GraphifyRunner } from './graphify-runner';
import type { IExecutionContext, ExecResult } from '@main/core/execution-context/types';

function fakeCtx(handler: (cmd: string, args: string[]) => ExecResult | Error): IExecutionContext {
  return {
    root: '/work',
    supportsLocalSpawn: true,
    async exec(cmd, args = []) {
      const out = handler(cmd, args);
      if (out instanceof Error) throw out;
      return out;
    },
    async execStreaming() {},
    dispose() {},
  };
}

describe('GraphifyRunner.probe', () => {
  it('reports python+graphify present when both version calls succeed', async () => {
    const ctx = fakeCtx(() => ({ stdout: 'ok', stderr: '' }));
    const runner = new GraphifyRunner(ctx);
    expect(await runner.probe()).toEqual({ python: true, graphify: true });
  });

  it('reports graphify false when its version call throws', async () => {
    const ctx = fakeCtx((cmd, args) => {
      if (cmd === 'graphify' || args.includes('graphify')) return new Error('not found');
      return { stdout: 'Python 3.12', stderr: '' };
    });
    const runner = new GraphifyRunner(ctx);
    expect(await runner.probe()).toEqual({ python: true, graphify: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/graphify-runner.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { GraphProbeResult } from '@shared/code-graph/types';

export class GraphifyRunner {
  constructor(private readonly ctx: IExecutionContext) {}

  private async ok(command: string, args: string[]): Promise<boolean> {
    try {
      await this.ctx.exec(command, args, { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async probe(): Promise<GraphProbeResult> {
    const python = await this.ok('python3', ['--version']);
    const graphify = await this.ok('graphify', ['--version']);
    return { python, graphify };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/graphify-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/graphify-runner.ts src/main/core/code-graph/graphify-runner.test.ts
git commit -m "feat(code-graph): GraphifyRunner probe for python/graphify"
```

---

## Task 4: GraphifyRunner — extract

**Files:**
- Modify: `src/main/core/code-graph/graphify-runner.ts`
- Modify: `src/main/core/code-graph/graphify-runner.test.ts`

- [ ] **Step 1: Write the failing test (append to existing describe block)**

```typescript
describe('GraphifyRunner.extract', () => {
  it('invokes `graphify extract --update` in the worktree root', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const ctx = fakeCtx((cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: '', stderr: '' };
    });
    const runner = new GraphifyRunner(ctx);
    await runner.extract();
    expect(calls).toContainEqual({ cmd: 'graphify', args: ['extract', '.', '--update'] });
  });

  it('returns false when extract throws', async () => {
    const ctx = fakeCtx(() => new Error('boom'));
    const runner = new GraphifyRunner(ctx);
    expect(await runner.extract()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/graphify-runner.test.ts`
Expected: FAIL — `runner.extract is not a function`.

- [ ] **Step 3: Write minimal implementation (add method to GraphifyRunner)**

```typescript
  /** Runs an incremental extract in the context's root. Returns success. */
  async extract(): Promise<boolean> {
    try {
      await this.ctx.exec('graphify', ['extract', '.', '--update'], { timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Installs graphify's post-commit hook + merge driver. Idempotent. Returns success. */
  async installHook(): Promise<boolean> {
    try {
      await this.ctx.exec('graphify', ['hook', 'install'], { timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/graphify-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/graphify-runner.ts src/main/core/code-graph/graphify-runner.test.ts
git commit -m "feat(code-graph): GraphifyRunner extract + installHook"
```

---

## Task 5: GraphifyRunner — read graph stats

**Files:**
- Modify: `src/main/core/code-graph/graphify-runner.ts`
- Modify: `src/main/core/code-graph/graphify-runner.test.ts`

The status popover needs symbol/file counts. Graphify writes `graphify-out/graph.json`; we read counts from it via the injected context's filesystem. To keep the runner context-agnostic, read the file through `ctx.exec('cat', [path])` (works local + SSH) and parse JSON.

- [ ] **Step 1: Write the failing test**

```typescript
describe('GraphifyRunner.readStats', () => {
  it('parses node/file counts from graph.json', async () => {
    const graph = JSON.stringify({
      nodes: [{ id: 'a', type: 'function' }, { id: 'b', type: 'file' }, { id: 'c', type: 'file' }],
    });
    const ctx = fakeCtx((cmd, args) => {
      if (cmd === 'cat') return { stdout: graph, stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const runner = new GraphifyRunner(ctx);
    const stats = await runner.readStats();
    expect(stats).toEqual({ symbolCount: 1, fileCount: 2 });
  });

  it('returns null when graph.json is absent', async () => {
    const ctx = fakeCtx(() => new Error('no such file'));
    const runner = new GraphifyRunner(ctx);
    expect(await runner.readStats()).toBeNull();
  });
});
```

> Note: confirm graph.json's actual node shape against Graphify's output during Task 6's integration check. If nodes are keyed differently (e.g. an object map or a `kind` field instead of `type`), adjust `readStats` and this test together. The `file` vs non-`file` split is the contract: `fileCount` = nodes whose type is `file`; `symbolCount` = the rest.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/graphify-runner.test.ts`
Expected: FAIL — `readStats is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import path from 'node:path';

  async readStats(): Promise<{ symbolCount: number; fileCount: number } | null> {
    try {
      const graphPath = path.join('graphify-out', 'graph.json');
      const { stdout } = await this.ctx.exec('cat', [graphPath], { timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
      const parsed = JSON.parse(stdout) as { nodes?: Array<{ type?: string }> };
      const nodes = parsed.nodes ?? [];
      let fileCount = 0;
      for (const n of nodes) if (n.type === 'file') fileCount += 1;
      return { symbolCount: nodes.length - fileCount, fileCount };
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/graphify-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/graphify-runner.ts src/main/core/code-graph/graphify-runner.test.ts
git commit -m "feat(code-graph): GraphifyRunner readStats from graph.json"
```

---

## Task 6: Manual integration check of the graphify CLI

**Files:** none (verification task — no code).

This de-risks the CLI contract the runner assumes (`extract . --update`, `hook install`, `graph.json` shape, `serve` invocation). Do this once against this repo.

- [ ] **Step 1: Install graphify locally**

Run: `uv tool install graphifyy || pipx install graphifyy`
Expected: graphify on PATH. Verify: `graphify --version`.

- [ ] **Step 2: Extract this repo into a temp worktree**

Run:
```bash
cd "$(mktemp -d)" && git clone --depth 1 /Users/gpleczynski/Code/rundash rg && cd rg
graphify extract . --update
ls graphify-out/
```
Expected: `graphify-out/graph.json` exists.

- [ ] **Step 2b: Confirm node shape**

Run: `head -c 2000 graphify-out/graph.json`
Expected: confirm there is a top-level `nodes` array and each node has a `type` field with `file` among the values. **If the shape differs, update Task 5's `readStats` + test now** before continuing.

- [ ] **Step 3: Confirm the MCP serve command + tool names**

Run: `graphify serve --help` (and `python -m graphify.serve --help`)
Expected: confirm the exact invocation (`python -m graphify.serve <graph.json>`) and that it exposes `query_graph` / `get_node` / `shortest_path`. **If the module path or args differ, note the exact form — Task 10 depends on it.**

- [ ] **Step 4: Record findings**

Append a short "CLI contract (verified)" note to the spec file documenting the exact `serve` invocation and graph.json shape, then commit:

```bash
git add docs/superpowers/specs/2026-06-06-code-graph-via-graphify-design.md
git commit -m "docs(code-graph): record verified graphify CLI contract"
```

---

## Task 7: MCP JSON writer — fresh file

**Files:**
- Create: `src/main/core/code-graph/mcp-json-writer.ts`
- Test: `src/main/core/code-graph/mcp-json-writer.test.ts`

Writes/merges the graphify stdio entry into a worktree's `.mcp.json`. Uses `jsonc-parser` (already a dependency — confirm via `grep jsonc-parser package.json`; it is used in `src/main/core/mcp/utils/config-io.ts`). I/O is injected as two functions so the merge logic is unit-testable without the filesystem.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mergeGraphifyEntry } from './mcp-json-writer';

const GRAPH = '/work/graphify-out/graph.json';

describe('mergeGraphifyEntry', () => {
  it('creates mcpServers.graphify in an empty/absent config', () => {
    const out = mergeGraphifyEntry(undefined, GRAPH);
    const parsed = JSON.parse(out);
    expect(parsed.mcpServers.graphify).toEqual({
      command: 'python3',
      args: ['-m', 'graphify.serve', GRAPH],
    });
  });

  it('preserves existing servers and other keys', () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: 'npx', args: ['-y', 'foo'] } },
      someUserKey: true,
    });
    const out = mergeGraphifyEntry(existing, GRAPH);
    const parsed = JSON.parse(out);
    expect(parsed.mcpServers.other).toEqual({ command: 'npx', args: ['-y', 'foo'] });
    expect(parsed.someUserKey).toBe(true);
    expect(parsed.mcpServers.graphify.args[2]).toBe(GRAPH);
  });

  it('overwrites only the graphify entry on re-write (dedupe by key)', () => {
    const existing = JSON.stringify({ mcpServers: { graphify: { command: 'old', args: [] } } });
    const out = mergeGraphifyEntry(existing, GRAPH);
    const parsed = JSON.parse(out);
    expect(parsed.mcpServers.graphify.command).toBe('python3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/mcp-json-writer.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { modify, applyEdits } from 'jsonc-parser';

const GRAPHIFY_KEY = 'graphify';

/** Returns the new .mcp.json text with the graphify stdio entry merged in.
 *  `existing` is the current file text, or undefined if the file is absent. */
export function mergeGraphifyEntry(existing: string | undefined, graphJsonPath: string): string {
  const entry = { command: 'python3', args: ['-m', 'graphify.serve', graphJsonPath] };
  const base = existing && existing.trim().length > 0 ? existing : '{}';
  const edits = modify(base, ['mcpServers', GRAPHIFY_KEY], entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  return applyEdits(base, edits);
}
```

> Note: use the same `jsonc-parser` API (`modify`/`applyEdits`) that `config-io.ts` uses, so behavior matches the rest of the app. Confirm the import names against that file before writing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/mcp-json-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/mcp-json-writer.ts src/main/core/code-graph/mcp-json-writer.test.ts
git commit -m "feat(code-graph): non-destructive .mcp.json graphify merge"
```

---

## Task 8: MCP JSON writer — filesystem write + registration check

**Files:**
- Modify: `src/main/core/code-graph/mcp-json-writer.ts`
- Modify: `src/main/core/code-graph/mcp-json-writer.test.ts`

Add a function that reads the worktree's `.mcp.json`, merges, and writes back — plus a check for whether the graphify entry is present.

- [ ] **Step 1: Write the failing test**

```typescript
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { writeGraphifyMcp, hasGraphifyEntry } from './mcp-json-writer';

describe('writeGraphifyMcp', () => {
  it('writes .mcp.json into the worktree and is detectable', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cg-'));
    const graph = path.join(dir, 'graphify-out', 'graph.json');
    writeGraphifyMcp(dir, graph);
    const file = path.join(dir, '.mcp.json');
    expect(existsSync(file)).toBe(true);
    expect(hasGraphifyEntry(dir)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers.graphify.args[2]).toBe(graph);
  });

  it('hasGraphifyEntry is false when no file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cg-'));
    expect(hasGraphifyEntry(dir)).toBe(false);
  });

  it('preserves a pre-existing user server on write', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cg-'));
    writeFileSync(path.join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { mine: { command: 'x', args: [] } } }));
    writeGraphifyMcp(dir, path.join(dir, 'graphify-out', 'graph.json'));
    const parsed = JSON.parse(readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
    expect(parsed.mcpServers.mine).toBeDefined();
    expect(parsed.mcpServers.graphify).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/mcp-json-writer.test.ts`
Expected: FAIL — `writeGraphifyMcp is not a function`.

- [ ] **Step 3: Write minimal implementation (append)**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function mcpPath(worktreeRoot: string): string {
  return path.join(worktreeRoot, '.mcp.json');
}

/** Reads, merges the graphify entry, and writes .mcp.json at the worktree root.
 *  Local-filesystem only (the worktree host runs this, not the laptop for SSH). */
export function writeGraphifyMcp(worktreeRoot: string, graphJsonPath: string): void {
  const file = mcpPath(worktreeRoot);
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  writeFileSync(file, mergeGraphifyEntry(existing, graphJsonPath));
}

export function hasGraphifyEntry(worktreeRoot: string): boolean {
  const file = mcpPath(worktreeRoot);
  if (!existsSync(file)) return false;
  try {
    return Boolean(JSON.parse(readFileSync(file, 'utf8'))?.mcpServers?.graphify);
  } catch {
    return false;
  }
}
```

> SSH/Docker note: for non-local worktree hosts, the file must be written *on that host*. In Task 13 the service writes via the worktree's execution context when `supportsLocalSpawn` is false. For local worktrees (the common case) this direct-fs path is used. The merge logic (Task 7) is shared by both.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/mcp-json-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/mcp-json-writer.ts src/main/core/code-graph/mcp-json-writer.test.ts
git commit -m "feat(code-graph): write .mcp.json to worktree + registration check"
```

---

## Task 9: CodeGraphService skeleton + status store

**Files:**
- Create: `src/main/core/code-graph/code-graph-service.ts`
- Test: `src/main/core/code-graph/code-graph-service.test.ts`

The service holds per-workspace status and emits the status event. This task is just the in-memory status map + getter + emit; extraction is wired in Task 11.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));

import { CodeGraphService } from './code-graph-service';
import { events } from '@main/lib/events';

describe('CodeGraphService status', () => {
  it('defaults unknown workspaces to unavailable', () => {
    const svc = new CodeGraphService();
    expect(svc.getStatus('w1').state).toBe('unavailable');
  });

  it('setStatus stores and emits', () => {
    const svc = new CodeGraphService();
    svc.setStatus('w1', { state: 'building' });
    expect(svc.getStatus('w1').state).toBe('building');
    expect(events.emit).toHaveBeenCalled();
  });
});
```

> Confirm the events emit helper path (`@main/lib/events`) by reading how `gitEvents`/`SearchService` emit; adjust the mock + import to the real path before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { events } from '@main/lib/events';
import { codeGraphStatusChannel } from '@shared/events/codeGraphEvents';
import type { CodeGraphStatus } from '@shared/code-graph/types';

export class CodeGraphService {
  private statuses = new Map<string, CodeGraphStatus>();

  getStatus(workspaceId: string): CodeGraphStatus {
    return this.statuses.get(workspaceId) ?? { workspaceId, state: 'unavailable' };
  }

  setStatus(workspaceId: string, patch: Partial<CodeGraphStatus>): void {
    const next: CodeGraphStatus = { ...this.getStatus(workspaceId), ...patch, workspaceId };
    this.statuses.set(workspaceId, next);
    events.emit(codeGraphStatusChannel, next);
  }
}

export const codeGraphService = new CodeGraphService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/code-graph-service.ts src/main/core/code-graph/code-graph-service.test.ts
git commit -m "feat(code-graph): CodeGraphService status map + emit"
```

---

## Task 10: Serialized per-repo queue + debounce on the service

**Files:**
- Modify: `src/main/core/code-graph/code-graph-service.ts`
- Modify: `src/main/core/code-graph/code-graph-service.test.ts`

Add the `enqueueGitOp`-style serialized queue (keyed per repo) and the debounce map. Mirror `worktree-service.ts:40-44` and `workspace-file-index-service.ts:156-168`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('CodeGraphService.enqueue', () => {
  it('serializes operations on the same key', async () => {
    const svc = new CodeGraphService();
    const order: number[] = [];
    const p1 = svc.enqueue('repoA', async () => { await new Promise(r => setTimeout(r, 30)); order.push(1); });
    const p2 = svc.enqueue('repoA', async () => { order.push(2); });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts -t enqueue`
Expected: FAIL — `enqueue is not a function`.

- [ ] **Step 3: Write minimal implementation (add to class)**

```typescript
  private queues = new Map<string, Promise<unknown>>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Serializes operations sharing a key (one repo at a time). */
  enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const result = prior.then(fn, fn);
    this.queues.set(key, result.catch(() => {}));
    return result as Promise<T>;
  }

  /** Debounces a callback per key (default 3s, matching the file index). */
  protected debounce(key: string, fn: () => void, ms = 3_000): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      fn();
    }, ms));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts -t enqueue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/code-graph-service.ts src/main/core/code-graph/code-graph-service.test.ts
git commit -m "feat(code-graph): serialized per-repo queue + debounce"
```

---

## Task 11: Wire extraction lifecycle into the service

**Files:**
- Modify: `src/main/core/code-graph/code-graph-service.ts`
- Modify: `src/main/core/code-graph/code-graph-service.test.ts`

Add `onWorkspaceCreated(workspaceId, deps)` and `onWorkspaceDestroyed(workspaceId)`. To keep it testable, `onWorkspaceCreated` takes an injected deps object exposing the runner, the worktree root, and a repo key — the real wiring (Task 14) builds these from the `Workspace`.

- [ ] **Step 1: Write the failing test**

```typescript
import { GraphifyRunner } from './graphify-runner';

function stubRunner(over: Partial<GraphifyRunner> = {}): GraphifyRunner {
  return {
    probe: async () => ({ python: true, graphify: true }),
    extract: async () => true,
    installHook: async () => true,
    readStats: async () => ({ symbolCount: 10, fileCount: 3 }),
    ...over,
  } as unknown as GraphifyRunner;
}

describe('CodeGraphService.onWorkspaceCreated', () => {
  it('sets unavailable (with hint) when probe finds no graphify', async () => {
    const svc = new CodeGraphService();
    const runner = stubRunner({ probe: async () => ({ python: true, graphify: false }) });
    await svc.onWorkspaceCreated('w1', { runner, worktreeRoot: '/work', repoKey: 'r1', writeMcp: () => {} });
    const s = svc.getStatus('w1');
    expect(s.state).toBe('unavailable');
    expect(s.hint).toMatch(/graphify/i);
  });

  it('extracts, writes mcp, and reaches ready when available', async () => {
    const svc = new CodeGraphService();
    let wroteMcp = false;
    const runner = stubRunner();
    await svc.onWorkspaceCreated('w2', {
      runner, worktreeRoot: '/work', repoKey: 'r2', writeMcp: () => { wroteMcp = true; },
    });
    await svc.flush('r2'); // wait for queued work
    const s = svc.getStatus('w2');
    expect(s.state).toBe('ready');
    expect(s.symbolCount).toBe(10);
    expect(wroteMcp).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts -t onWorkspaceCreated`
Expected: FAIL — `onWorkspaceCreated is not a function`.

- [ ] **Step 3: Write minimal implementation (add to class)**

```typescript
import type { GraphifyRunner } from './graphify-runner';

export interface WorkspaceGraphDeps {
  runner: GraphifyRunner;
  worktreeRoot: string;
  repoKey: string;
  /** Writes/merges the worktree .mcp.json pointing at graph.json. */
  writeMcp: () => void;
}

  private deps = new Map<string, WorkspaceGraphDeps>();

  async onWorkspaceCreated(workspaceId: string, deps: WorkspaceGraphDeps): Promise<void> {
    this.deps.set(workspaceId, deps);
    const probe = await deps.runner.probe();
    if (!probe.python || !probe.graphify) {
      this.setStatus(workspaceId, {
        state: 'unavailable',
        hint: 'Install graphify (`uv tool install graphifyy`) on this host to enable the code graph.',
      });
      return;
    }
    this.scheduleExtract(workspaceId);
  }

  onWorkspaceDestroyed(workspaceId: string): void {
    this.deps.delete(workspaceId);
    this.statuses.delete(workspaceId);
  }

  /** Public so git/fs events can request a (debounced) re-extract.
   *  No-ops when the workspace is unavailable (no graphify) to avoid churn. */
  scheduleExtract(workspaceId: string): void {
    const deps = this.deps.get(workspaceId);
    if (!deps) return;
    if (this.getStatus(workspaceId).state === 'unavailable') return;
    this.debounce(`extract:${workspaceId}`, () => {
      void this.enqueue(deps.repoKey, () => this.runExtract(workspaceId));
    });
  }

  /** Force an immediate (still serialized) re-extract — used by the Re-index button. */
  async reindex(workspaceId: string): Promise<void> {
    const deps = this.deps.get(workspaceId);
    if (!deps) return;
    await this.enqueue(deps.repoKey, () => this.runExtract(workspaceId));
  }

  private async runExtract(workspaceId: string): Promise<void> {
    const deps = this.deps.get(workspaceId);
    if (!deps) return;
    this.setStatus(workspaceId, { state: 'building' });
    const ok = await deps.runner.extract();
    if (!ok) {
      this.setStatus(workspaceId, { state: 'error', hint: 'graphify extract failed' });
      return;
    }
    await deps.runner.installHook();
    deps.writeMcp();
    const stats = await deps.runner.readStats();
    this.setStatus(workspaceId, {
      state: 'ready',
      symbolCount: stats?.symbolCount,
      fileCount: stats?.fileCount,
      indexedAt: undefined, // stamped by caller-free clock in Task 12
      mcpRegistered: true,
    });
  }

  /** Test helper: await any queued work for a repo key. */
  async flush(repoKey: string): Promise<void> {
    await (this.queues.get(repoKey) ?? Promise.resolve());
  }
```

> `indexedAt` is left undefined here because `Date.now()` is avoided in pure logic; Task 12 injects a clock. The two ready-state tests above don't assert `indexedAt`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts -t onWorkspaceCreated`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/code-graph-service.ts src/main/core/code-graph/code-graph-service.test.ts
git commit -m "feat(code-graph): lifecycle extract -> mcp write -> ready/unavailable"
```

---

## Task 12: Stamp indexedAt via an injected clock

**Files:**
- Modify: `src/main/core/code-graph/code-graph-service.ts`
- Modify: `src/main/core/code-graph/code-graph-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('indexedAt', () => {
  it('stamps ready status with the injected clock', async () => {
    const svc = new CodeGraphService(() => 12345);
    await svc.onWorkspaceCreated('w3', {
      runner: stubRunner(), worktreeRoot: '/work', repoKey: 'r3', writeMcp: () => {},
    });
    await svc.flush('r3');
    expect(svc.getStatus('w3').indexedAt).toBe(12345);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts -t indexedAt`
Expected: FAIL — constructor takes no clock / `indexedAt` undefined.

- [ ] **Step 3: Write minimal implementation**

Add a constructor and use it in `runExtract`:

```typescript
  constructor(private readonly now: () => number = () => Date.now()) {}
```

In `runExtract`, change the ready `setStatus` to `indexedAt: this.now()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/code-graph-service.test.ts`
Expected: PASS (all service tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/code-graph-service.ts src/main/core/code-graph/code-graph-service.test.ts
git commit -m "feat(code-graph): stamp indexedAt via injected clock"
```

---

## Task 13: RPC controller

**Files:**
- Create: `src/main/core/code-graph/controller.ts`
- Modify: `src/main/rpc.ts`
- Test: `src/main/core/code-graph/controller.test.ts`

Mirror `src/main/core/search/controller.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { codeGraphController } from './controller';

describe('codeGraphController', () => {
  it('exposes getStatus and reindex', () => {
    expect(typeof codeGraphController.getStatus).toBe('function');
    expect(typeof codeGraphController.reindex).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/core/code-graph/controller.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { createRPCController } from '@shared/ipc/rpc';
import { codeGraphService } from './code-graph-service';

export const codeGraphController = createRPCController({
  getStatus: (workspaceId: string) => codeGraphService.getStatus(workspaceId),
  reindex: (workspaceId: string) => codeGraphService.reindex(workspaceId),
});
```

Then register in `src/main/rpc.ts`: add the import near the other controller imports (e.g. next to line 27's `searchController` import):

```typescript
import { codeGraphController } from './core/code-graph/controller';
```

and add to the `createRPCRouter({...})` object (near line 73's `search:`):

```typescript
  codeGraph: codeGraphController,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/core/code-graph/controller.test.ts && pnpm run typecheck`
Expected: PASS and typecheck clean (confirms `rpc.codeGraph` is now typed for the renderer).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/code-graph/controller.ts src/main/rpc.ts src/main/core/code-graph/controller.test.ts
git commit -m "feat(code-graph): RPC controller + router registration"
```

---

## Task 14: Wire into workspace lifecycle

**Files:**
- Modify: `src/main/core/workspaces/workspace-factory.ts`

This is the integration seam — it builds `WorkspaceGraphDeps` from the real `Workspace` and subscribes to git changes. Mirror how `workspaceFileIndexService` is wired (around lines 184 and 236).

- [ ] **Step 1: Add the create-side wiring**

In `onCreateSideEffect`, near the existing `void workspaceFileIndexService.onWorkspaceCreated(workspaceId, ws);` (line ~184), add:

```typescript
import { codeGraphService } from '@main/core/code-graph/code-graph-service';
import { GraphifyRunner } from '@main/core/code-graph/graphify-runner';
import { writeGraphifyMcp } from '@main/core/code-graph/mcp-json-writer';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import path from 'node:path';

// inside onCreateSideEffect, after the file-index wiring:
void codeGraphService.onWorkspaceCreated(workspaceId, {
  runner: new GraphifyRunner(new LocalExecutionContext({ root: ws.path })),
  worktreeRoot: ws.path,
  repoKey: ws.path, // one repo checkout per worktree path; serialize per path
  writeMcp: () => writeGraphifyMcp(ws.path, path.join(ws.path, 'graphify-out', 'graph.json')),
});
```

> If `ws` exposes a stable project/repo id, prefer that as `repoKey` so multiple worktrees of the same repo serialize together. `ws.path` is a safe default (serializes per worktree). Confirm against the `Workspace` type.

- [ ] **Step 2: Subscribe to git changes**

In the same `onCreateSideEffect`, near the existing `ws.git.on('status:updated', …)` handler (lines ~160-178), add a second listener (or extend the existing one) to trigger re-extraction:

```typescript
ws.git.on('status:updated', () => {
  codeGraphService.scheduleExtract(workspaceId);
});
```

- [ ] **Step 3: Add the destroy-side wiring**

In `onDestroy` (near line ~236, beside `workspaceFileIndexService.onWorkspaceDestroyed(workspaceId)`):

```typescript
codeGraphService.onWorkspaceDestroyed(workspaceId);
```

- [ ] **Step 4: Verify build + types**

Run: `pnpm run typecheck`
Expected: clean. (No new unit test here — this is glue verified by typecheck + the Task 17 manual run.)

- [ ] **Step 5: Commit**

```bash
git add src/main/core/workspaces/workspace-factory.ts
git commit -m "feat(code-graph): wire CodeGraphService into workspace lifecycle"
```

---

## Task 15: Renderer status store

**Files:**
- Create: `src/renderer/features/code-graph/code-graph-status-store.ts`
- Test: `src/renderer/tests/code-graph-status.test.tsx`

Mirror the MobX `Resource` + event-subscription pattern from `src/renderer/features/tasks/diff-view/stores/git-store.ts:22-96`. Read the real `Resource` API and `events.on` import from that file before writing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { CodeGraphStatusStore } from '@renderer/features/code-graph/code-graph-status-store';

describe('CodeGraphStatusStore', () => {
  it('constructs for a workspace id', () => {
    const store = new CodeGraphStatusStore('w1');
    expect(store.workspaceId).toBe('w1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/renderer/tests/code-graph-status.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Resource } from '@renderer/lib/resource'; // confirm path from git-store.ts import
import { rpc } from '@renderer/lib/ipc';
import { events } from '@renderer/lib/ipc'; // confirm the renderer events import used in git-store.ts
import { codeGraphStatusChannel } from '@shared/events/codeGraphEvents';
import type { CodeGraphStatus } from '@shared/code-graph/types';

export class CodeGraphStatusStore {
  readonly status: Resource<CodeGraphStatus>;
  constructor(public readonly workspaceId: string) {
    this.status = new Resource<CodeGraphStatus>(
      () => rpc.codeGraph.getStatus(workspaceId),
      [
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(codeGraphStatusChannel, (payload) => {
              if (payload.workspaceId === workspaceId) handler();
            }),
          onEvent: 'reload',
          debounceMs: 100,
        },
      ]
    );
  }
}
```

> The exact `Resource` import path, constructor signature, and renderer `events` import must be copied from `git-store.ts`. Adjust imports to match; the structure above mirrors lines 22-96 there.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/renderer/tests/code-graph-status.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/code-graph/code-graph-status-store.ts src/renderer/tests/code-graph-status.test.tsx
git commit -m "feat(code-graph): renderer status store"
```

---

## Task 16: Status pill + detail popover component

**Files:**
- Create: `src/renderer/features/code-graph/CodeGraphStatusPill.tsx`
- Test: `src/renderer/tests/code-graph-status.test.tsx` (extend)

Use existing UI primitives (`Tooltip`/`Popover` as used in `agent-status-indicator.tsx`; confirm whether the design system has a `Popover`). Render: a pill colored by state; on click, a popover with counts, last-indexed, MCP-registered check, and a Re-index button calling `rpc.codeGraph.reindex`.

- [ ] **Step 1: Write the failing test (extend the file)**

```typescript
import { render, screen } from '@testing-library/react';
import { CodeGraphStatusPill } from '@renderer/features/code-graph/CodeGraphStatusPill';

describe('CodeGraphStatusPill', () => {
  it('renders the building label', () => {
    render(<CodeGraphStatusPill status={{ workspaceId: 'w', state: 'building' }} onReindex={() => {}} />);
    expect(screen.getByText(/building/i)).toBeTruthy();
  });

  it('renders symbol count when ready', () => {
    render(<CodeGraphStatusPill
      status={{ workspaceId: 'w', state: 'ready', symbolCount: 42, fileCount: 7 }}
      onReindex={() => {}} />);
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });

  it('shows the install hint when unavailable', () => {
    render(<CodeGraphStatusPill
      status={{ workspaceId: 'w', state: 'unavailable', hint: 'Install graphify' }}
      onReindex={() => {}} />);
    expect(screen.getByText(/install graphify/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/renderer/tests/code-graph-status.test.tsx`
Expected: FAIL — cannot find `CodeGraphStatusPill`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { CodeGraphStatus } from '@shared/code-graph/types';

const LABEL: Record<CodeGraphStatus['state'], string> = {
  unavailable: 'Graph: unavailable',
  building: 'Graph: building…',
  ready: 'Graph: ready',
  error: 'Graph: error',
};

export function CodeGraphStatusPill({
  status,
  onReindex,
}: {
  status: CodeGraphStatus;
  onReindex: () => void;
}) {
  return (
    <div className="code-graph-pill" data-state={status.state}>
      <span>{LABEL[status.state]}</span>
      <div className="code-graph-detail" role="group">
        {status.state === 'ready' && (
          <p>{status.symbolCount ?? 0} symbols · {status.fileCount ?? 0} files</p>
        )}
        {status.mcpRegistered && <p>MCP server registered ✓</p>}
        {status.hint && <p>{status.hint}</p>}
        <button type="button" onClick={onReindex}>Re-index</button>
      </div>
    </div>
  );
}
```

> This is a minimal, test-passing version. Replace the inline markup with the project's `Tooltip`/`Popover` primitives (see `agent-status-indicator.tsx`) and Tailwind classes during a follow-up styling pass — keep the same props and text so tests stay green.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/renderer/tests/code-graph-status.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount it in the worktree header**

Locate the worktree/task header component (search: `grep -rl "AgentStatusIndicator" src/renderer/features/tasks`). In that header, instantiate `CodeGraphStatusStore` (via the existing store/hook pattern for that view) and render:

```tsx
<CodeGraphStatusPill
  status={codeGraphStatusStore.status.value ?? { workspaceId, state: 'unavailable' }}
  onReindex={() => rpc.codeGraph.reindex(workspaceId)}
/>
```

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/code-graph/CodeGraphStatusPill.tsx src/renderer/tests/code-graph-status.test.tsx src/renderer/features/tasks
git commit -m "feat(code-graph): status pill + detail popover in worktree header"
```

---

## Task 17: Manual end-to-end verification

**Files:** none (verification).

- [ ] **Step 1: Full local merge gate**

Run: `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: all pass.

- [ ] **Step 2: Run the app, create a worktree on this repo**

Run: `pnpm run dev`
Then create a task/worktree in the UI. Observe the pill: `building…` → `ready`, with non-zero symbol/file counts in the popover.

- [ ] **Step 3: Confirm `.mcp.json` was written**

Run: `cat <the-new-worktree-path>/.mcp.json`
Expected: contains `mcpServers.graphify` with `args` ending in that worktree's `graphify-out/graph.json`.

- [ ] **Step 4: Confirm the agent sees the tool**

Launch a Claude Code agent in that worktree and ask it to list MCP tools / use `query_graph`. Expected: the graphify tools are available and a structural query returns results without a full-repo grep.

- [ ] **Step 5: Confirm graceful degradation**

Temporarily rename the graphify binary (or test on a host without it). Expected: pill shows `unavailable` with the install hint; the app otherwise works normally; no errors in the normal flow.

- [ ] **Step 6: Commit any fixes found**

```bash
git add -A && git commit -m "fix(code-graph): address issues found in manual verification"
```

---

## Task 18: Bake Python + graphify into the Docker runner image

**Files:**
- Modify: `packages/emdash-server/runner/Dockerfile`

- [ ] **Step 1: Read the current Dockerfile**

Read `packages/emdash-server/runner/Dockerfile` to see the base image (`node:22-slim` per the runner design) and how git/claude are installed.

- [ ] **Step 2: Add Python + graphify install layer**

Add after the existing tool-install steps:

```dockerfile
# Code-graph: Python + graphify (MIT) for the agent's code-graph MCP server
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip pipx \
    && rm -rf /var/lib/apt/lists/* \
    && pipx install graphifyy \
    && pipx ensurepath
ENV PATH="/root/.local/bin:${PATH}"
```

> Adjust the user/PATH to match the runner image's actual user (the runner runs containers as the host uid:gid; confirm where pipx installs and that `graphify` is on PATH for that user). Verify `python3` and `graphify` resolve.

- [ ] **Step 3: Build the image and verify**

Run (from the runner dir):
```bash
docker build -t rundash-runner-test packages/emdash-server/runner
docker run --rm rundash-runner-test bash -lc "python3 --version && graphify --version"
```
Expected: both versions print.

- [ ] **Step 4: Commit**

```bash
git add packages/emdash-server/runner/Dockerfile
git commit -m "feat(emdash-server): bake python + graphify into runner image"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** provision/probe (T3, T11), per-worktree extract on create+git change debounced/serialized (T4, T10, T11, T14), commit-hook install (T4, T11), project-local `.mcp.json` non-destructive merge (T7, T8), status RPC + pill + popover + Re-index (T13, T15, T16), code-only/zero-API (extract has no LLM flags), runner image (T18), graceful degradation (T11 unavailable + T17 step 5). All spec jobs map to tasks.
- **CLI-contract risk** is isolated to T6 (verified once) with explicit "update T5/T10 if shape differs" callouts, so unknowns in Graphify's output don't silently propagate.
- **Type consistency:** `CodeGraphStatus`/`GraphProbeResult`/`WorkspaceGraphDeps` defined once (T1, T11) and reused; method names (`getStatus`, `setStatus`, `enqueue`, `scheduleExtract`, `reindex`, `onWorkspaceCreated/Destroyed`, `probe`, `extract`, `installHook`, `readStats`, `mergeGraphifyEntry`, `writeGraphifyMcp`, `hasGraphifyEntry`) are consistent across tasks.
- **Known import-path confirmations** (flagged inline, not guesses): `defineEvent`/events emit helper, `Resource` + renderer `events`, `jsonc-parser` API — each task says to confirm against the cited existing file before writing.
