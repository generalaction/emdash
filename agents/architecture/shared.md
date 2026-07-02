# Shared Modules

## Main Shared Areas

- Provider registry (UI / legacy-PTY parity metadata — provider capabilities and behavior
  are plugin-first, see `agents/integrations/providers.md`):
  - `src/shared/core/agents/agent-provider-registry.ts`
- IPC primitives:
  - `src/shared/lib/ipc/rpc.ts` — typed RPC router, controller, and client
  - `src/shared/lib/ipc/events.ts` — typed event emitter
- Typed event definitions:
  - `src/shared/events/` — cross-cutting events not tied to one domain: `appEvents.ts`,
    `browserEvents.ts`, `githubEvents.ts`, `resourceEvents.ts`, `updateEvents.ts`
  - domain-scoped events live alongside their domain under `src/shared/core/<domain>/`,
    e.g. `src/shared/core/agents/agentEvents.ts`, `src/shared/core/fs/fsEvents.ts`,
    `src/shared/core/pty/ptyEvents.ts`, `src/shared/core/ssh/sshEvents.ts`
- MCP types:
  - `src/shared/core/mcp/`
- Skills types and validation:
  - `src/shared/core/skills/`
- Domain type modules (moved under `src/shared/core/<domain>/`):
  - `src/shared/core/conversations/conversations.ts`, `src/shared/core/fs/fs.ts`,
    `src/shared/core/pull-requests/pull-requests.ts`, `src/shared/core/ssh/ssh.ts`,
    `src/shared/core/tasks/tasks.ts`, `src/shared/core/terminals/terminals.ts`
  - a few remain flat at `src/shared/`: `github.ts`, `projects.ts`, `urls.ts`
- PTY helpers:
  - `src/shared/core/pty/ptyId.ts`, `src/shared/core/pty/ptySessionId.ts`
- App settings types:
  - `src/shared/core/app-settings.ts`

## Path Aliases

Aliases are defined in `tsconfig.json`; each electron-vite build target (`main`, `preload`,
`renderer`) mirrors only the subset it needs — not every alias is mirrored everywhere:

| Alias | Resolves to | Mirrored in electron-vite |
| --- | --- | --- |
| `@/*` | `src/*` | main, renderer |
| `@renderer/*` | `src/renderer/*` | renderer |
| `@main/*` | `src/main/*` | main |
| `@shared/*` | `src/shared/*` | main, preload, renderer |
| `@root/*` | `./*` | main, preload, renderer |
| `@tooling/*` | `tooling/*` | not mirrored — Vitest-only alias, see `agents/risky-areas/database.md` |

Aliases are resolved at build time by electron-vite (bundled code) or by `tsc`/Vitest for
type-checking and tests. No runtime monkey-patching is needed.

## Provider Registry Rules

Provider capabilities/behavior are plugin-first. See `agents/integrations/providers.md` for
the full "Adding Or Changing A Provider" checklist — plugins under
`packages/plugins/src/agents/impl/`, then the UI parity entry in
`src/shared/core/agents/agent-provider-registry.ts`.
