import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Aggregates registration of every MCP tool category onto the SDK `McpServer`.
 *
 * Eventual responsibilities: call `register(server)` from each per-domain
 * tool module (tasks, projects, mcp, skills, worktrees, system).
 *
 * Currently a stub — no-op. Filled in by T4+.
 */
export function registerAllTools(_server: McpServer): void {}
