
---
default_branch: dev
package_manager: pnpm
node_version: "24.x.x"
start_command: "pnpm run d"
dev_command: "pnpm run dev"
build_command: "pnpm run build"
test_commands:
  - "pnpm run format"
  - "pnpm run lint"
  - "pnpm run typecheck"
  - "pnpm run test"
ports:
  dev: 3000
required_env: []
optional_env:
  - TELEMETRY_ENABLED
  - EMDASH_DB_FILE
  - EMDASH_DISABLE_NATIVE_DB
  - EMDASH_DISABLE_CLONE_CACHE
  - EMDASH_DISABLE_PTY
  - CODEX_SANDBOX_MODE
  - CODEX_APPROVAL_POLICY
---

# Emdash Agent Guide

Start here. Load only the linked `agents/` docs that are relevant to the task.

## Start Here

- Repo map: `agents/README.md`
- Setup and commands: `agents/quickstart.md`
- System overview: `agents/architecture/overview.md`
- Validation flow: `agents/workflows/testing.md`

## Read By Task

- Main-process changes: `agents/architecture/main-process.md`
- Renderer/UI changes: `agents/architecture/renderer.md`
- Shared types or provider metadata: `agents/architecture/shared.md`
- Worktree behavior or `.emdash.json`: `agents/workflows/worktrees.md`
- SSH or remote project work: `agents/workflows/remote-development.md`
- Provider integration or CLI behavior: `agents/integrations/providers.md`
- MCP changes: `agents/integrations/mcp.md`

## High-Risk Areas

- Database and migrations: `agents/risky-areas/database.md`
- PTY/session orchestration: `agents/risky-areas/pty.md`
- SSH and shell escaping: `agents/risky-areas/ssh.md`
- Auto-update and packaging: `agents/risky-areas/updater.md`

## Conventions

- IPC contract and typing: `agents/conventions/ipc.md`
- Main process patterns (controllers, services, Result type, events): `agents/conventions/main-patterns.md`
- Renderer patterns (modals, views, PTY frontend, React Query contexts): `agents/conventions/renderer-patterns.md`
- TypeScript and React norms: `agents/conventions/typescript.md`
- Config files and repo rules: `agents/conventions/config-files.md`
- Never do re exports always import from the original source

### State Guard Conventions (renderer stores)

`ProjectStore` and `TaskStore` are mutable MobX class instances that transition through states. Use the following layers — do not mix them:

**Selectors** (`task-selectors.ts`, `project-selectors.ts`) — pure functions, safe in observer components, effects, and event handlers:
- `getTaskStore(projectId, taskId)` → `TaskStore | undefined`
- `asProvisioned(store)` → `ProvisionedTask | undefined` (use with explicit null check, never `!`)
- `taskViewKind(store, projectId)` → `TaskViewKind`
- `getTaskManagerStore(projectId)` → `TaskManagerStore | undefined` (use this instead of reaching through project store)
- `getProjectStore(projectId)` → `ProjectStore | undefined`
- `asMounted(store)` → `MountedProject | undefined` (use with explicit null check, never `!`)

**Hooks** (`task-view-context.tsx`) — for `observer` components inside the task view tree:
- `useTaskViewKind()` — routing/state-gating
- `useProvisionedTask()` → `ProvisionedTask | null` — when the component handles a non-provisioned state
- `useRequireProvisionedTask()` → `ProvisionedTask` — when the component must only render when provisioned (throws with a descriptive error if the invariant is violated)

**Rules:**
- Never `asProvisioned(...)!` or `asMounted(...)!` — use the hook or an explicit null check
- State guards must use `kind !== 'ready'`, never enumerate non-ready states (new states would silently fall through)
- Access task manager via `getTaskManagerStore(projectId)`, not through `project.taskManager`
- Access mounted project via `asMounted(getProjectStore(id))`, not via inline `isMountedProject` guards

## emdash-dev (Tauri 2 + Rust rewrite)

A second product lives under `src-tauri/` — the Tauri 2 + Rust rewrite. It
ships **alongside** the Electron app, not as a replacement. Conventions and
decisions for it live in `docs/decisions/` (Michael Nygard ADRs).

Rules specific to `src-tauri/`:

- **Domain code in `lib.rs` must stay free of `tauri::AppHandle`.** Modules
  reachable through `pub mod` from `lib.rs` (`shell_env`, `greeting`, etc.)
  must not use `#[tauri::command]` annotations or import/accept
  `tauri::AppHandle`, `tauri::Window`, or any webview-runtime type.
  `src-tauri/tests/domain_boundaries.rs` enforces this with a source-level
  guard. The near-empty `src-tauri/src/bin/emdash-cli.rs` exists to keep the
  library modules compiling from a non-webview entry point.
- **Every command must be allowlisted.** `src-tauri/allowed-commands.json`
  enumerates the channels exposed through `invoke_handler`. `build.rs`
  fails the build if `ui/src/bindings.ts` and the allowlist drift. To add
  a command: write it under `src/commands/`, append to
  `collect_commands![]` in `app.rs`, run
  `cargo run --bin emdash-dev -- --export-bindings`, then add the channel
  name to `allowed-commands.json`.
- **`ui/src/bindings.ts` is generated and committed.** Do not hand-edit it.
  Regenerate via the `--export-bindings` flag above (debug builds also
  regenerate on startup). Wire-format changes are pinned by an `insta`
  snapshot in `tests/wire_format.rs`; deliberate changes need
  `cargo insta accept`.
- **Single `UiMutationEvent` bridge** *(placeholder, lands in [EMD-7](https://linear.app/emdash-helmor/issue/EMD-7))*.
  Renderer state mutations will flow through exactly one event channel;
  rule details ship with that issue.
- **Versions are pinned exactly.** `tauri`, `tauri-build`, `tauri-specta`,
  `specta`, and `specta-typescript` are pinned with `=`. Bumping any of
  them is a deliberate PR; see ADR-0001 for the reasoning.

Build/test commands for `src-tauri/`:

```bash
cd src-tauri
cargo check                         # type-check + run capability allowlist
cargo test                          # unit + wire-format snapshot tests
cargo run --bin emdash-cli -- -V    # invariant: CLI compiles without webview
cargo run --bin emdash-dev -- --export-bindings   # regenerate bindings.ts
```

`cargo tauri dev` requires the Tauri CLI: `cargo install tauri-cli --locked --version "^2"`.

## Non-Negotiables

- Run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm test` before merging.
- Do not hand-edit numbered Drizzle migrations or `drizzle/meta/`.
- New RPC methods go in the appropriate `src/main/core/*/controller.ts` and are auto-registered via `src/main/rpc.ts`.
- Only use manual IPC in `electron-api.d.ts` for methods requiring `event.sender`.
- New modals must be registered in `src/renderer/core/modal/registry.ts`.
- New views must be registered in `src/renderer/core/view/registry.ts`.
- Treat `src/main/core/pty/`, `src/main/core/ssh/`, `src/main/db/`, and updater code as high risk.
- Avoid editing `dist/`, `release/`, and `build/` unless the task is explicitly about packaging or updater/signing behavior.
- The docs app in `docs/` is separate from the Electron renderer and also defaults to port `3000`.
