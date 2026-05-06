# MCP

## Main Files

- `src/main/core/mcp/services/McpService.ts`
- `src/main/core/mcp/utils/` — adapters, catalog, config IO, config paths, conversion
- `src/main/core/mcp/controller.ts`
- `src/shared/mcp/`
- `src/renderer/components/mcp/`
- `src/renderer/views/mcp-view.tsx`

## Current Behavior

- MCP server configs are read, adapted, merged, and written across supported agent ecosystems
- provider-specific config formats are handled through adapters in `src/main/core/mcp/utils/`
- the renderer MCP UI manages installed servers and catalog entries

## Important Constraint

- Codex currently supports stdio MCP servers only

## Rules

- do not assume all providers support the same MCP transport types
- keep canonical MCP data in shared types and adapt at the edges
- if you add provider-specific MCP behavior, update both service and UI compatibility handling
