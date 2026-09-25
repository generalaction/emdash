# Agent Docs

This directory is the system of record for agent-facing repo guidance. Keep topic pages small, specific, and mechanically checkable where possible.

## Recommended Reading Order

1. `quickstart.md`
2. `architecture/overview.md`
3. the task-specific page for the area you are changing

## Directory Layout

- `architecture/`
  - system structure and major code ownership boundaries
  - [`core-modules.md`](architecture/core-modules.md) — Core runtime, service, and primitive module types, platform surfaces, dependency rules, and subpath exports
  - [`workspace-server.md`](architecture/workspace-server.md) — protocol versioning, negotiation handshake, and behavior-change rules for the remote workspace daemon
  - [`state-ownership.md`](architecture/state-ownership.md) — desktop-owned entities, host-owned resources, bindings, and the placement rule for operation behavior
  - [`acp-runtime.md`](architecture/acp-runtime.md) — ACP runtime, session manager, connection pool, cells, live models, and API contract ownership
  - [`git-runtime.md`](architecture/git-runtime.md) — Git contract/runtime ownership, session lifecycle, and nested wire composition
  - [`path-system.md`](architecture/path-system.md) — host-aware path identity, resource URI ownership, and future migration boundaries
  - [`styling.md`](architecture/styling.md) — Theme and Token ownership, CSS loading and layers, Surfaces, Host Adapters, integrations, and debugging
- `workflows/`
  - task-oriented procedures like testing, worktrees, remote development, and Nx task orchestration
- `integrations/`
  - provider, MCP, and external service guidance
  - [`integration-plugins.md`](integrations/integration-plugins.md) — integration auth and credential contracts, stable account identity, and issue-plugin boundaries
- `risky-areas/`
  - places where incorrect changes are expensive
- `conventions/`
  - coding contracts and repo rules
  - [`ui-kit.md`](conventions/ui-kit.md) — component selection, ownership, popup/list/settings patterns, and theming entry points
  - [`ui-styling.md`](conventions/ui-styling.md) — import homes, authoring decisions, ownership rules, review checks, and focused commands

## Maintenance Rules

- Prefer one page per concrete topic.
- Avoid volatile counts unless you can verify them cheaply.
- Link to the source-of-truth file paths.
- Update the smallest relevant page instead of expanding `AGENTS.md`.
