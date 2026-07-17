# Shared Modules

## Main Shared Areas

- Agent/provider DTOs:
  - `src/shared/core/agents/agent-payload.ts`
  - provider metadata and capabilities are sourced from `packages/plugins/src/agents/registry.ts`
- IPC primitives:
  - `src/shared/ipc/rpc.ts` — typed RPC router, controller, and client
  - `src/shared/ipc/events.ts` — typed event emitter
- Typed event definitions:
  - `src/shared/events/` — `agentEvents.ts`, `appEvents.ts`, `editorEvents.ts`, `fsEvents.ts`, `githubEvents.ts`, `hostPreviewEvents.ts`, `lifecycleEvents.ts`, `ptyEvents.ts`, `sshEvents.ts`
- MCP types:
  - `src/shared/mcp/`
- Skills types and validation:
  - `src/shared/skills/`
- Domain type modules (flat files):
  - `conversations.ts`, `fs.ts`, `git.ts`, `github.ts`, `hostPreview.ts`, `lifecycle.ts`, `projects.ts`, `pull-requests.ts`, `ssh.ts`, `tasks.ts`, `terminals.ts`, `urls.ts`, `utils.ts`
- PTY helpers:
  - `ptySessionId.ts` (provider-aware PTY ID parsing lives in main under `src/main/core/pty/`)
- App settings types:
  - `app-settings.ts`

## Path Aliases

All aliases are defined in a single `tsconfig.json` and mirrored in `electron.vite.config.ts`:

| Alias | Resolves to |
| --- | --- |
| `@/*` | `src/*` |
| `@renderer/*` | `src/renderer/*` |
| `@main/*` | `src/main/*` |
| `@shared/*` | `src/shared/*` |
| `@root/*` | `./*` |

Aliases are resolved at build time by electron-vite. No runtime monkey-patching is needed.

## Provider Metadata Rules

When adding a provider:

1. add or update its plugin in `packages/plugins/src/agents/impl/` and register it in
   `packages/plugins/src/agents/registry.ts`
2. add any required env passthrough in `src/main/core/pty/pty-env.ts`
3. add or update hook/plugin installation in `src/main/core/agent-hooks/` if the provider
   supports explicit events
4. update renderer surfaces that consume agent metadata from `rpc.agents.*`
5. add tests for non-standard spawn or detection behavior
