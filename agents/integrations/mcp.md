# MCP

## Main Files

- `src/main/core/mcp/services/McpService.ts` — queries `pluginRegistry` for providers whose
  `capabilities.mcp.kind === 'supported'` and calls `provider.behavior.mcp!.readServers` /
  `writeServers` / `removeServer`
- `src/main/core/mcp/utils/` — `catalog.ts` (server catalog) and `registration.ts` (generic
  registration/type conversion helpers); no per-provider adapters live here
- `src/main/core/mcp/controller.ts`
- `src/shared/core/mcp/` — shared MCP types (`types.ts`)
- `packages/core/src/agents/plugins/capabilities/mcp.ts` — the `IMcpBehavior` contract
  (`readServers`/`writeServers`/`removeServer`)
- `packages/plugins/src/agents/impl/<provider>/index.ts` — per-provider MCP adapter (e.g.
  Claude's `passthroughMcpAdapter('.claude.json')`, Codex's `codexMcpAdapter()`)
- `src/renderer/features/mcp/` (`mcp-view.tsx`, `components/`)

## Current Behavior

- MCP server configs are read, adapted, merged, and written per provider through
  `provider.behavior.mcp` on the plugin registry, not through app-level utils
- `src/main/core/mcp/utils/` only provides the generic catalog and registration/type
  normalization — provider-specific format handling lives in each provider's plugin
- the renderer MCP UI manages installed servers and catalog entries

## Rules

- do not assume all providers support the same MCP transport types
- keep canonical MCP data in shared types (`src/shared/core/mcp/`) and adapt at the
  plugin-behavior edge, not in app-level utils
- if you add provider-specific MCP behavior, implement it in the provider's plugin
  (`packages/plugins/src/agents/impl/<provider>/`) and update UI compatibility handling
