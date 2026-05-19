import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from './mcp-tools';
import { registerProjectTools } from './project-tools';
import { registerSkillTools } from './skill-tools';
import { registerSystemTools } from './system-tools';
import { registerTaskTools } from './task-tools';
import { registerWorktreeTools } from './worktree-tools';

/**
 * Aggregates registration of every MCP tool category onto the SDK `McpServer`.
 *
 * Per-domain tool modules are registered in alphabetical order so the tool
 * list the SDK reports back to clients is deterministic.
 */
export function registerAllTools(server: McpServer): void {
  registerMcpTools(server);
  registerProjectTools(server);
  registerSkillTools(server);
  registerSystemTools(server);
  registerTaskTools(server);
  registerWorktreeTools(server);
}
