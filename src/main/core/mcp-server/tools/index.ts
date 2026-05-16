import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTaskTools } from './task-tools';

/**
 * Aggregates registration of every MCP tool category onto the SDK `McpServer`.
 *
 * Per-domain tool modules are registered in alphabetical order so the tool
 * list the SDK reports back to clients is deterministic.
 *
 * T4 wired the `task.*` tools. T5+ will fill in the remaining domains
 * (projects, mcp servers, skills, worktrees, system).
 */
export function registerAllTools(server: McpServer): void {
  registerTaskTools(server);
}
