/**
 * `emdash-mcp` — standalone Node entrypoint that bridges stdio (used by
 * external MCP clients like Claude Code, Cursor, Codex) to the loopback HTTP
 * MCP server hosted inside the Electron main process.
 *
 * Eventual responsibilities (see
 * `docs/superpowers/specs/2026-05-16-mcp-server-design.md`):
 * - Read `~/.emdash/mcp.json` to discover the local port and bearer token.
 * - Open an HTTP MCP session against `127.0.0.1:<port>` with
 *   `Authorization: Bearer <token>`.
 * - Pipe the SDK stdio transport on this process to the HTTP transport.
 *
 * Wiring into `electron.vite.config.ts` and `electron-builder.config.ts` is
 * deferred to task T9.
 *
 * Currently a stub — prints a message to stderr and exits 0.
 */
function main(): void {
  process.stderr.write('emdash-mcp stub\n');
  process.exit(0);
}

main();
