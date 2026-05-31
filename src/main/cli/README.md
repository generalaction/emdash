# emdash CLI

A headless command-line surface for emdash that operates on the **same SQLite
database and git worktrees as the desktop app**, by reusing the app's own
main-process modules (schema, key-hash, worktree service, agent-command builder,
tmux session naming). The goal is that artifacts it creates are
indistinguishable from UI-created ones.

```
emdash workspace list   [--project <name>] [--include-archived] [--json]
emdash workspace create --project <p> --branch <b> [--base <branch>] [--name <n>]
                        [--checkout-existing | --no-worktree] [--push-branch]
                        [--prompt "<text>" [--agent <name>] [--auto-approve]] [--json]
emdash workspace remove --project <p> (--branch <b> | --id <id>)
                        [--pre-remove <cmd>] [--skip-hook] [--force] [--json]
emdash workspace send   --project <p> (--branch <b> | --id <id>) --message "<text>" [--json]
```

## Build & run

```bash
pnpm build:cli          # esbuild bundle → out/cli/index.cjs
pnpm cli workspace list # = ELECTRON_RUN_AS_NODE=1 electron bin/emdash-cli.mjs …
```

It runs under **Electron-as-Node** so `better-sqlite3`'s native ABI matches the
desktop build. The bundle is **CJS** (not the app's ESM main) because under
`ELECTRON_RUN_AS_NODE` the `electron` module is a stub with no named exports — a
CJS `require('electron')` yields `undefined` for the unused APIs, which is fine
because every electron use in the import graph is lazy/guarded and the launcher
sets `EMDASH_DB_FILE` before the DB client loads.

## Design

- **Core is db-injected and Electron-free** (`workspace-commands.ts`,
  `agent-dispatch.ts`, `local-worktree.ts`, `args.ts`) so it unit-tests against a
  temp SQLite db via `openFixture`. The entry (`index.ts`) wires the real db,
  settings provider, and agent dispatcher.
- **Reuse over reimplementation:** worktree creation uses the app's
  `WorktreeService`; the key hash uses `computeWorkspaceKey`; agent launch uses
  `buildAgentSessionCommand`; the tmux session name uses
  `makeTmuxSessionName(makePtySessionId(...))` — so the app re-attaches to a
  CLI-launched agent.
- **`create` is atomic:** the git worktree is created first; DB rows are written
  only on success. **`remove` is hook-gated** (capture-before-delete) and
  defaults to safe branch deletion (`-d`); `-D` only with `--force`.

## Test coverage

`src/main/cli/*.test.ts` (node) + `*.db.test.ts` (main-db, real SQLite + git):
arg parsing, list filtering/archived, create (atomicity, idempotency, remote
base, push, prompt-dispatch), remove (teardown, idempotency, hook abort/skip,
unmerged-branch retention, cross-project `--id` refusal, out-of-pool rm guard),
send (text+Enter sequence, no-active-session), and the pure tmux-argv builder.

> **CI note:** emdash's CI (`code-consistency-check.yml`) runs only
> `format:check` + `typecheck` + `lint` — it does **not** run the test suite.
> These tests must be run locally (`pnpm test`) or CI should be extended to run
> `vitest --project node --project main-db`.

## Risks & known limitations

**Safe:** `list` (read-only) and `create` (additive, atomic).

**Sharp — `remove`:** force-deletes worktree + (with `--force`) branch + DB rows.
Mitigations in place: safe branch delete by default, worktree-rm restricted to
the project's worktree pool, `--id` scoped to the project, agent tmux session
killed first, pre-remove capture hook that aborts on failure. Still, a wrong
target tears down real state — treat as `rm`-class.

**Deliberately scoped out / known gaps** (acceptable for a local/dogfood tool;
listed for reviewers):

- **Concurrency with the running app:** the CLI writes the live DB (WAL handles
  locking) but assumes it isn't racing the app on the *same* task. No app-level
  coordination.
- **Orphaned child rows:** deleting a task leaves `conversations`/`terminals`/
  `messages` rows (FK cascade is OFF on the connection app-wide; the app's own
  `deleteTask` behaves the same — not changed here to avoid divergence).
- **`create --prompt` adoption requires tmux mode ON** for the project; otherwise
  the app spawns its own agent on open (the CLI warns). Hook env
  (`EMDASH_HOOK_PORT`, …) and `.emdash.json` task env vars are not forwarded to
  CLI-launched agents, so status detection / task env can differ until the app
  adopts the session. Keystroke-injection providers (grok/hermes/…) don't get
  the prompt at launch (reported `promptDelivered:false`, non-zero exit).
- **No `--from-issue/--from-pr`, no prompt templates, local projects only.**
- **Internal-module coupling:** importing `@main/*` (not a public API) means the
  CLI must move in lockstep with the app; typecheck catches signature drift, but
  *runtime* drift (tmux naming, command builder, prompt timing) would need a
  smoke test to catch. A stale `out/cli/index.cjs` after an app upgrade can write
  old-shape rows — rebuild on upgrade.
- **`bin/emdash-cli.mjs` re-implements the default DB path** (it must stay
  Electron-free and load before the build) — keep it in sync with
  `src/main/db/default-path.ts`.

## Unverified in the live app (needs a human eyeball)

- A CLI-created workspace shows in the sidebar after a reload (confirmed once by
  a tester; the app doesn't live-refresh external DB writes).
- The app **re-attaches** to a `create --prompt` tmux agent (vs spawning a
  duplicate) when tmux mode is on.
