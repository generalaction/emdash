---
default_branch: main
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

This file is the entry point. Load only the `agents/` docs you actually need for the task at hand — don't pre-load everything.

## Orientation

| Need | File |
| --- | --- |
| Repo map | `agents/README.md` |
| Setup & commands | `agents/quickstart.md` |
| System overview | `agents/architecture/overview.md` |
| How to validate work | `agents/workflows/testing.md` |

## Load By Task

**Code areas**
- Main process → `agents/architecture/main-process.md`
- Renderer / UI → `agents/architecture/renderer.md`
- Shared types, provider metadata → `agents/architecture/shared.md`

**Workflows**
- Worktrees, `.emdash.json` → `agents/workflows/worktrees.md`
- SSH / remote projects → `agents/workflows/remote-development.md`

**Integrations**
- Providers / CLI behavior → `agents/integrations/providers.md`
- MCP → `agents/integrations/mcp.md`

**High-risk — read before touching**
- Database & migrations → `agents/risky-areas/database.md`
- PTY / session orchestration → `agents/risky-areas/pty.md`
- SSH & shell escaping → `agents/risky-areas/ssh.md`
- Auto-update & packaging → `agents/risky-areas/updater.md`

## Conventions

- IPC contract & typing → `agents/conventions/ipc.md`
- Main process patterns (controllers, services, `Result`, events) → `agents/conventions/main-patterns.md`
- Renderer patterns (modals, views, PTY frontend, React Query contexts) → `agents/conventions/renderer-patterns.md`
- TypeScript & React norms → `agents/conventions/typescript.md`
- Config files & repo rules → `agents/conventions/config-files.md`

**Import rule:** never re-export — always import from the original source.

### Renderer state guards (MobX stores)

`ProjectStore` and `TaskStore` are mutable class instances that transition through states. Use one of these three layers; do not mix them.

**Selectors** — pure functions, safe in observers, effects, and event handlers
| Function | Returns |
| --- | --- |
| `getProjectStore(projectId)` | `ProjectStore \| undefined` |
| `getTaskStore(projectId, taskId)` | `TaskStore \| undefined` |
| `getTaskManagerStore(projectId)` | `TaskManagerStore \| undefined` (use instead of `project.taskManager`) |
| `asMounted(store)` | `MountedProject \| undefined` (explicit null check — never `!`) |
| `asProvisioned(store)` | `ProvisionedTask \| undefined` (explicit null check — never `!`) |
| `taskViewKind(store, projectId)` | `TaskViewKind` |

Selectors live in `task-selectors.ts` / `project-selectors.ts`.

**Hooks** — for `observer` components inside the task view tree (`task-view-context.tsx`)
- `useTaskViewKind()` — for routing / state-gating
- `useProvisionedTask()` → `ProvisionedTask | null` — when the component handles non-provisioned states
- `useRequireProvisionedTask()` → `ProvisionedTask` — when the component must only render when provisioned (throws with a descriptive error otherwise)

**Hard rules**
- Never write `asProvisioned(...)!` or `asMounted(...)!` — use the hook or an explicit null check.
- State guards must check `kind !== 'ready'`. Never enumerate the non-ready states — a new state would silently fall through.
- Access the task manager via `getTaskManagerStore(projectId)`, not `project.taskManager`.
- Access a mounted project via `asMounted(getProjectStore(id))`, not via inline `isMountedProject` guards.

## Non-Negotiables

**Before merging, run all four:**
```
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm test
```

**Code & infra rules**
- Do not hand-edit numbered Drizzle migrations or anything under `drizzle/meta/`.
- New RPC methods → add to the appropriate `src/main/core/*/controller.ts`; they're auto-registered via `src/main/rpc.ts`. Only fall back to manual IPC in `electron-api.d.ts` when the method needs `event.sender`.
- New modals → register in `src/renderer/core/modal/registry.ts`.
- New views → register in `src/renderer/core/view/registry.ts`.
- Treat `src/main/core/pty/`, `src/main/core/ssh/`, `src/main/db/`, and updater code as high risk — read the matching `agents/risky-areas/*.md` first.
- Don't touch `dist/`, `release/`, or `build/` unless the task is explicitly about packaging or updater/signing behavior.
- The docs app in `docs/` is a separate Next.js app and also defaults to port `3000` — mind the port clash when running both.
