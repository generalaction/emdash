# Plan 002: Kill timed-out usage workers, correlate responses to requests, and make the orchestration testable

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ecb2a2125..HEAD -- src/main/core/usage-stats/usage-stats-service.ts src/main/core/usage-stats/usage-worker.ts src/main/core/usage-stats/worker-request.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (behavior-preserving on the happy path; changes only failure handling)
- **Depends on**: none (composes cleanly with plan 001; if 001 landed first, `getSnapshot`
  looks different — irrelevant here, this plan touches `computeInWorker`/worker only)
- **Category**: bug + tests
- **Planned at**: commit `ecb2a2125`, 2026-06-11

## Why this matters

Two defects live in the usage-stats worker orchestration, and the code that contains them
is the only untested code in the feature:

1. **A timed-out worker is never killed.** On timeout the service removes its listeners and
   falls back to an inline compute, but the (possibly wedged) utilityProcess keeps running
   and stays cached as `this.worker`, so the next refresh reuses it.
2. **Responses aren't correlated to requests.** If request N times out and the worker later
   finishes, that late reply sits in the channel; request N+1 attaches a fresh listener and
   consumes the *stale* response (computed with an older `now` and possibly older pricing
   rates) as its own result.

The fix for both lives naturally in a small, Electron-free request/response helper that
unit tests can exercise with a fake worker — which also closes the test gap.

## Current state

- `src/main/core/usage-stats/usage-stats-service.ts` — service; `computeInWorker`
  (lines 53–81) and `ensureWorker` (lines 83–95). The promise body to be extracted:

```ts
  private computeInWorker(indexPath: string, now: Date): Promise<UsageSnapshot> {
    const worker = this.ensureWorker();
    const rates: Array<[string, ModelRate]> = [...getRemoteRates().entries()];

    return new Promise<UsageSnapshot>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('exit', onExit);
      };
      const onMessage = (res: WorkerResponse): void => {
        cleanup();
        if (res.ok) resolve(res.snapshot);
        else reject(new Error(res.error));
      };
      const onExit = (code: number): void => {
        cleanup();
        reject(new Error(`usage worker exited (${code}) before responding`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('usage worker timed out'));
      }, WORKER_TIMEOUT_MS);

      worker.on('message', onMessage);
      worker.on('exit', onExit);
      worker.postMessage({ indexPath, rates, nowISO: now.toISOString() });
    });
  }
```

  `ensureWorker` already nulls `this.worker` on `'exit'`, so killing a worker makes the
  next refresh respawn one — that mechanism needs no change.

- `src/main/core/usage-stats/usage-worker.ts` — the utilityProcess entry (24 lines). It
  currently defines and exports the message types:

```ts
type Request = { indexPath: string; rates: Array<[string, ModelRate]>; nowISO: string };
export type WorkerResponse = { ok: true; snapshot: UsageSnapshot } | { ok: false; error: string };

process.parentPort.on('message', (e) => {
  const { indexPath, rates, nowISO } = e.data as Request;
  let res: WorkerResponse;
  try {
    setRemoteRates(new Map(rates));
    res = { ok: true, snapshot: runPipeline(indexPath, new Date(nowISO)) };
  } catch (err) {
    res = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  process.parentPort.postMessage(res);
});
```

- `usage-worker.ts` is a separate rollup entry (see `electron.vite.config.ts`,
  `rollupOptions.input['usage-worker']`) — it must never import `electron` itself
  (it only uses the ambient `process.parentPort`).
- Repo conventions: strict TS, no `any` (a documented local escape is acceptable at a
  boundary), colocated `*.test.ts`, Vitest in the `node` project. Pure-module exemplar:
  `src/main/core/usage-stats/cache.ts` + `cache.test.ts`.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Typecheck | `pnpm run typecheck`                                      | exit 0              |
| Tests     | `pnpm vitest run --project node src/main/core/usage-stats/` | all pass            |
| Lint      | `pnpm run lint`                                           | exit 0              |
| Format    | `pnpm run format`                                         | exit 0              |
| Build (worker bundles) | `pnpm run build:main`                       | exit 0; `out/main/usage-worker.js` exists |

## Scope

**In scope** (the only files you may modify/create):
- `src/main/core/usage-stats/worker-request.ts` (create)
- `src/main/core/usage-stats/worker-request.test.ts` (create)
- `src/main/core/usage-stats/usage-stats-service.ts`
- `src/main/core/usage-stats/usage-worker.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `electron.vite.config.ts` — the worker entry config is already correct.
- `src/main/core/usage-stats/pipeline.ts`, `pricing.ts` — message *payload* semantics
  (rates forwarding) are unchanged; only an id is added to the envelope.
- The inline fallback path in `compute()` — keep it exactly as is.

## Git workflow

- Work on the current branch (`stats-4ahru`).
- Two commits suggested:
  1. `refactor(usage-stats): extract worker request/response into testable helper`
  2. `fix(usage-stats): kill timed-out worker and drop stale responses by request id`
  (One combined commit is acceptable.)
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Create the helper module with request ids

Create `src/main/core/usage-stats/worker-request.ts`. It must not import `electron`.
Move the message types here (single source of truth for both sides of the channel):

```ts
import type { UsageSnapshot } from '@shared/usage';
import type { ModelRate } from './pricing';

export type WorkerRequest = {
  reqId: number;
  indexPath: string;
  rates: Array<[string, ModelRate]>;
  nowISO: string;
};
export type WorkerResponse = { reqId: number } & (
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; error: string }
);

/** The slice of Electron's UtilityProcess this helper needs — kept structural so tests can fake it. */
export type WorkerLike = {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (res: WorkerResponse) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  off(event: 'message', listener: (res: WorkerResponse) => void): unknown;
  off(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
};

let nextReqId = 1;

/**
 * Send one compute request and await its response. Hardened against two failure modes:
 * a response carrying a different reqId is ignored (it belongs to an earlier, timed-out
 * request — consuming it would resolve with a stale snapshot), and on timeout the worker
 * is killed so the service respawns a fresh one instead of reusing a wedged process.
 */
export function requestSnapshot(
  worker: WorkerLike,
  payload: Omit<WorkerRequest, 'reqId'>,
  timeoutMs: number
): Promise<UsageSnapshot> {
  const reqId = nextReqId++;
  return new Promise<UsageSnapshot>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('exit', onExit);
    };
    const onMessage = (res: WorkerResponse): void => {
      if (res.reqId !== reqId) return; // stale response from a previous request
      cleanup();
      if (res.ok) resolve(res.snapshot);
      else reject(new Error(res.error));
    };
    const onExit = (code: number): void => {
      cleanup();
      reject(new Error(`usage worker exited (${code}) before responding`));
    };
    const timer = setTimeout(() => {
      cleanup();
      worker.kill(); // wedged: make the service respawn next time
      reject(new Error('usage worker timed out'));
    }, timeoutMs);

    worker.on('message', onMessage);
    worker.on('exit', onExit);
    worker.postMessage({ ...payload, reqId });
  });
}
```

**Verify**: `pnpm run typecheck` → exit 0 (the old code still compiles; nothing imports
the new module yet).

### Step 2: Echo the reqId in the worker

In `usage-worker.ts`: delete the local `Request` type and the exported `WorkerResponse`
type; import both from `./worker-request` (type-only import — confirm no runtime import
of anything Electron-touching). Destructure `reqId` from `e.data` and include it in both
the ok and error responses:

```ts
import type { WorkerRequest, WorkerResponse } from './worker-request';
// ...
process.parentPort.on('message', (e) => {
  const { reqId, indexPath, rates, nowISO } = e.data as WorkerRequest;
  let res: WorkerResponse;
  try {
    setRemoteRates(new Map(rates));
    res = { reqId, ok: true, snapshot: runPipeline(indexPath, new Date(nowISO)) };
  } catch (err) {
    res = { reqId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  process.parentPort.postMessage(res);
});
```

**Verify**: `pnpm run typecheck` → likely FAILS now because
`usage-stats-service.ts` still imports `WorkerResponse` from `./usage-worker` — that's
expected; fix in Step 3 and re-verify there.

### Step 3: Use the helper in the service

In `usage-stats-service.ts`:
- Change the import `import type { WorkerResponse } from './usage-worker'` to
  `import { requestSnapshot } from './worker-request'`.
- Replace the whole `computeInWorker` body with:

```ts
  private computeInWorker(indexPath: string, now: Date): Promise<UsageSnapshot> {
    const rates: Array<[string, ModelRate]> = [...getRemoteRates().entries()];
    return requestSnapshot(
      this.ensureWorker(),
      { indexPath, rates, nowISO: now.toISOString() },
      WORKER_TIMEOUT_MS
    );
  }
```

- `ensureWorker` returns `UtilityProcess`; it should satisfy `WorkerLike` structurally.
  If TypeScript rejects the assignment because of `UtilityProcess`'s listener overloads,
  adapt by widening `WorkerLike`'s listener parameter types (e.g. accept
  `(...args: any[]) => void` with a one-line comment documenting the boundary escape per
  repo convention) — do NOT cast the worker itself to `any`.

**Verify**: `pnpm run typecheck` → exit 0. Then `pnpm run build:main` → exit 0 and
`ls out/main/usage-worker.js` shows the file.

### Step 4: Tests for the helper

Create `src/main/core/usage-stats/worker-request.test.ts`. Build a `FakeWorker`
implementing `WorkerLike` with listener arrays, a `sent: WorkerRequest[]` log, an
`emitMessage(res)` / `emitExit(code)` helper, a `killed` flag, and a
`listenerCount()` helper. Use `vi.useFakeTimers()` for the timeout case. Use
`EMPTY_USAGE_SNAPSHOT` from `@shared/usage` as the snapshot payload. Cases (≥6):

1. Resolves with the snapshot when a response with the matching `reqId` arrives.
2. Rejects with the error message on an `ok: false` response.
3. **Ignores a response with a mismatched `reqId`**, then resolves on the matching one
   (this is the stale-response regression test).
4. On timeout: rejects with `'usage worker timed out'`, **`killed` is true**, and
   `listenerCount()` is 0.
5. Rejects with `exited (…)` when `exit` fires before any response.
6. After resolution, `listenerCount()` is 0 (no leaked listeners).

Model the file structure on `src/main/core/usage-stats/cache.test.ts` (plain
`describe`/`it`, small local factories).

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/worker-request.test.ts` → all pass.

### Step 5: Full gate

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/` → all pass;
`pnpm run lint` → exit 0; `pnpm run format` → exit 0.

## Test plan

Covered by Step 4 (six named cases). No test for `ensureWorker` itself — it needs a real
Electron `utilityProcess` and is three lines of respawn logic already exercised in dev.

## Done criteria

ALL must hold:

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm vitest run --project node src/main/core/usage-stats/` exits 0, including ≥6 new worker-request tests
- [ ] `pnpm run build:main` exits 0 and `out/main/usage-worker.js` exists
- [ ] `grep -n "reqId" src/main/core/usage-stats/usage-worker.ts` returns matches (echo wired)
- [ ] `grep -n "kill()" src/main/core/usage-stats/worker-request.ts` returns a match
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `computeInWorker` in the live file doesn't match the "Current state" excerpt.
- `usage-worker.ts` would need a runtime (non-type) import from a module that imports
  `electron` — that breaks the separate-bundle constraint.
- The `UtilityProcess` → `WorkerLike` structural assignment can't be made to typecheck
  without casting the worker object itself.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The reqId counter is module-global and monotonic per process — fine for a singleton
  service; if multiple services ever share the worker, move the counter into the service.
- Reviewer should scrutinize: that the mismatched-reqId branch does NOT call `cleanup()`
  (the listener must stay armed for the real response), and that timeout still falls back
  to the inline pass in `compute()` exactly as before.
- Deferred deliberately: per-request timeout tuning and worker health-checks — no evidence
  they're needed yet.
