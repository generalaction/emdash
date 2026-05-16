import type { IDisposable, IInitializable } from '@main/lib/lifecycle';

/**
 * Singleton service that owns the lifecycle of the in-process emdash MCP HTTP
 * server.
 *
 * Eventual responsibilities (see `docs/superpowers/specs/2026-05-16-mcp-server-design.md`):
 * - React to the `mcpServer.enabled` app setting and start/stop the
 *   loopback `McpHttpServer` accordingly.
 * - Coordinate token rotation (`token-store`) and recent-call telemetry
 *   (`recent-calls`) for the Settings UI.
 * - Wire `@modelcontextprotocol/sdk` tools and resources via `createMcpServer`.
 *
 * Currently a stub — `initialize()` and `dispose()` are no-ops. Wiring into
 * `src/main/index.ts` is deferred to task T3.
 */
export class McpServerService implements IInitializable, IDisposable {
  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    return Promise.resolve();
  }
}

export const mcpServerService = new McpServerService();
