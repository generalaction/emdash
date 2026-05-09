# Shared Modules

## Main Shared Areas

- Provider registry:
  - `src/shared/agent-provider-registry.ts`
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
  - `ptyId.ts`, `ptySessionId.ts`
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

## Provider Registry Rules

When adding a provider:

1. update `src/shared/agent-provider-registry.ts`
2. add any required env passthrough in `src/main/core/pty/pty-env.ts`
3. add an agent event classifier in `src/main/core/conversations/impl/agent-event-classifiers/`
4. update renderer surfaces that assume provider metadata
5. add tests for non-standard spawn or detection behavior
