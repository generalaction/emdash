/**
 * Loopback HTTP transport for the emdash MCP server.
 *
 * Eventual responsibilities:
 * - Bind a Node `http.Server` to `127.0.0.1:<port>` (loopback only).
 * - Validate the `Authorization: Bearer <token>` header against the persisted
 *   token from `token-store`.
 * - Reject requests whose `Host` header is not `127.0.0.1:<port>` or
 *   `localhost:<port>` (DNS-rebinding mitigation).
 * - Hand authenticated sessions off to the `@modelcontextprotocol/sdk`
 *   `Server` instance produced by `createMcpServer`.
 *
 * Currently a stub — `start` and `stop` are no-ops.
 */
export class McpHttpServer {
  async start(_port: number, _token: string): Promise<void> {
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }
}
