import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Aggregates registration of every MCP resource onto the SDK `McpServer`.
 *
 * Eventual responsibilities: call `register(server)` from each per-domain
 * resource module (projects, tasks, task sessions).
 *
 * Currently a stub — no-op. Filled in by T4+.
 */
export function registerAllResources(_server: McpServer): void {}
