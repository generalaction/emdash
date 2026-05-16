/**
 * RPC controller for the renderer Settings page that drives the emdash MCP
 * server (start/stop, port changes, token rotation, recent calls).
 *
 * The renderer Settings view (T8) consumes this via the auto-generated
 * `mcpServer.*` RPC namespace.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpServerStatus } from '@shared/events/mcpServerEvents';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok, type Result } from '@shared/result';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import {
  recentCallsRing,
  type RecentCallEntry,
  type RecentCallSnapshotOptions,
} from './recent-calls';
import { getBridgeCommand, mcpServerService } from './service';

/**
 * Returns the live status snapshot. Never fails (the underlying service
 * always returns a status, defaulting to `enabled=false, running=false`).
 */
async function getStatus(): Promise<Result<McpServerStatus, never>> {
  const status = await mcpServerService.getStatus();
  return ok(status);
}

/**
 * Toggle `appSettings.mcpServer.enabled` and reconcile the service so the
 * HTTP transport starts/stops to match.
 */
async function setEnabled(args: { enabled: boolean }): Promise<Result<void, string>> {
  try {
    const current = await appSettingsService.get('mcpServer');
    await appSettingsService.update('mcpServer', { ...current, enabled: args.enabled });
    await mcpServerService.reconcile();
    return ok(undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[mcp-server] setEnabled failed', error);
    return err(message);
  }
}

/**
 * Update `appSettings.mcpServer.port` (and reconcile). Port validation lives
 * in the settings schema — invalid values bubble out via the Zod failure
 * message.
 */
async function setPort(args: { port: number }): Promise<Result<void, string>> {
  try {
    const current = await appSettingsService.get('mcpServer');
    await appSettingsService.update('mcpServer', { ...current, port: args.port });
    await mcpServerService.reconcile();
    return ok(undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[mcp-server] setPort failed', error);
    return err(message);
  }
}

/**
 * Regenerate the bearer token, persist it to `~/.emdash/mcp.json`, and
 * restart the running HTTP transport so live sessions are forced to
 * reconnect with the new token.
 */
async function rotateToken(): Promise<Result<{ token: string }, string>> {
  try {
    const result = await mcpServerService.rotateToken();
    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[mcp-server] rotateToken failed', error);
    return err(message);
  }
}

/** Read the recent-calls ring buffer for the Settings page's live list. */
async function getRecentCalls(
  args?: RecentCallSnapshotOptions
): Promise<Result<RecentCallEntry[], never>> {
  return ok(recentCallsRing.snapshot(args ?? {}));
}

/**
 * Return the absolute path of the token file. The renderer uses the existing
 * shell APIs to open it; the controller intentionally does not perform any
 * filesystem reveal itself (separation of concerns + testability).
 */
async function revealTokenFile(): Promise<Result<{ path: string }, string>> {
  try {
    const path = join(homedir(), '.emdash', 'mcp.json');
    return ok({ path });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(message);
  }
}

/**
 * Generate copy-paste config snippets for popular MCP clients. Uses the
 * **stdio bridge** form — external clients spawn `emdash-mcp` (a small
 * stdio→HTTP shim) instead of speaking HTTP directly so they don't have to
 * juggle a bearer token themselves.
 *
 * `getBridgeCommand()` resolves the actually-deployable command: the
 * unpacked resource path inside the packaged app, or the dev-time
 * `out/main/emdash-mcp.js` build artifact otherwise. The bin reads
 * `~/.emdash/mcp.json` for the token itself, so we never inline the bearer
 * token here — only the port (mirrored into `EMDASH_MCP_PORT` so the bridge
 * can override the file's port without a restart).
 */
async function getConfigSnippets(): Promise<
  Result<{ claudeCode: string; cursor: string; codex: string }, string>
> {
  try {
    const status = await mcpServerService.getStatus();
    // Fall back to the configured (not necessarily bound) port if the server
    // isn't running yet — the snippet is still useful for "I'll start it
    // later" workflows.
    const settings = await appSettingsService.get('mcpServer');
    const port = status.port ?? settings.port;
    const { command, args } = getBridgeCommand();

    const claudeCode = JSON.stringify(
      {
        mcpServers: {
          emdash: {
            command,
            args,
            env: { EMDASH_MCP_PORT: String(port) },
          },
        },
      },
      null,
      2
    );

    const cursor = JSON.stringify(
      {
        mcpServers: {
          emdash: {
            command,
            args,
            env: { EMDASH_MCP_PORT: String(port) },
          },
        },
      },
      null,
      2
    );

    // Codex's MCP config uses a TOML block.
    const codex = [
      '[mcp_servers.emdash]',
      `command = "${command}"`,
      `args = ${JSON.stringify(args)}`,
      '',
      '[mcp_servers.emdash.env]',
      `EMDASH_MCP_PORT = "${port}"`,
    ].join('\n');

    return ok({ claudeCode, cursor, codex });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[mcp-server] getConfigSnippets failed', error);
    return err(message);
  }
}

export const mcpServerController = createRPCController({
  getStatus,
  setEnabled,
  setPort,
  rotateToken,
  getRecentCalls,
  revealTokenFile,
  getConfigSnippets,
});
