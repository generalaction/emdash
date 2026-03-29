# MCP

## Main Files

- `src/main/services/McpService.ts`
- `src/main/services/mcp/`
- `src/shared/mcp/`
- `src/renderer/components/mcp/`

## Current Behavior

- MCP server configs are read, adapted, merged, and written across supported agent ecosystems
- provider-specific config formats are handled through adapters in `src/main/services/mcp/`
- the renderer MCP UI manages installed servers and catalog entries
- save/remove operations use a 2-phase flow:
  - read phase is atomic, any read/parse failure aborts before writes begin
  - write phase is best-effort, provider writes continue and failures are reported after all attempts
- when a write phase partially succeeds, the thrown error reports both failed agents and any configs that were updated before the failure

## Important Constraint

- Codex currently supports stdio MCP servers only

## Rules

- do not assume all providers support the same MCP transport types
- keep canonical MCP data in shared types and adapt at the edges
- if you add provider-specific MCP behavior, update both service and UI compatibility handling
