import { defineEvent } from '@shared/ipc/events';

/**
 * Live status of the in-process emdash MCP HTTP server. Emitted whenever the
 * service starts, stops, restarts, or encounters an error so the renderer
 * Settings page can reflect the current state without polling.
 */
export interface McpServerStatus {
  /** User-visible toggle from `appSettings.mcpServer.enabled`. */
  enabled: boolean;
  /** True iff the loopback HTTP server is currently accepting connections. */
  running: boolean;
  /** Bound TCP port (`null` when the server is not running). */
  port: number | null;
  /** True iff `~/.emdash/mcp.json` exists and parsed successfully. */
  tokenPresent: boolean;
  /** Milliseconds since the current run started; `0` when not running. */
  uptimeMs: number;
  /** Last error message surfaced by the service, or `null` if healthy. */
  lastError: string | null;
}

/**
 * Channel for live MCP server status updates. Fired on every state change
 * (enable/disable, restart, port change, error → recovery).
 */
export const mcpServerStatusChannel = defineEvent<McpServerStatus>('mcp-server:status');

/**
 * Channel for one-shot MCP server errors that should be surfaced to the user
 * (e.g. EADDRINUSE on startup). The status channel also carries `lastError`
 * for steady-state display; this channel is intended for transient toasts.
 */
export const mcpServerErrorChannel = defineEvent<{
  code: string;
  message: string;
}>('mcp-server:error');
