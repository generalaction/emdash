# Shared Modules

## Main Shared Areas

- Provider registry:
  - `src/shared/providers/registry.ts`
- IPC helpers:
  - `src/shared/ipc/`
- MCP types:
  - `src/shared/mcp/`
- Diff, git, task, SSH, and text helpers:
  - `src/shared/diff/`
  - `src/shared/git/`
  - `src/shared/task/`
  - `src/shared/ssh/`
  - `src/shared/text/`

## Important Alias Rules

`@/*` resolves differently in main and renderer:

| Alias | Renderer | Main |
| --- | --- | --- |
| `@/*` | `src/renderer/*` | `src/*` |
| `@shared/*` | `src/shared/*` | `src/shared/*` |
| `#types/*` | `src/types/*` | unavailable |

Runtime alias handling for compiled main output is set up in `src/main/entry.ts`.

## Provider Registry Rules

When adding a provider:

1. update `src/shared/providers/registry.ts`
2. add any required env passthrough in `src/main/services/ptyManager.ts`
3. update renderer surfaces that assume provider metadata
4. add tests for non-standard spawn or detection behavior
