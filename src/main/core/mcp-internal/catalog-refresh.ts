import { join } from 'node:path';
import { app } from 'electron';
import type { McpServer } from '@shared/mcp/types';
import { mcpService } from '@main/core/mcp/services/McpService';
import { log } from '@main/lib/logger';
import type { McpInternalInstance } from './instance';

export const EMDASH_MCP_SERVER_NAME = 'emdash';

/**
 * Resolves the bundled emdash-mcp subprocess script path. With
 * `out/mcp-server/**` listed in `asarUnpack`, the file lives at
 * `<app.asar.unpacked>/out/mcp-server/index.cjs` in packaged builds.
 */
function resolveMcpServerScript(): string {
  const appPath = app.getAppPath();
  const root = app.isPackaged ? appPath.replace('app.asar', 'app.asar.unpacked') : appPath;
  return join(root, 'out', 'mcp-server', 'index.cjs');
}

/**
 * Build the canonical McpServer entry for emdash with the current launch's
 * loopback URL, instance ID, and bearer token. Per-conversation env
 * (SESSION_ID, TASK_ID, PROJECT_ID) flows through PTY inherited env — see
 * docs/mcp-internal-spec.md §4.
 */
export function buildEmdashServer(
  instance: McpInternalInstance,
  statusUrl: string,
  providers: string[]
): McpServer {
  return {
    name: EMDASH_MCP_SERVER_NAME,
    transport: 'stdio',
    command: process.execPath,
    args: [resolveMcpServerScript()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      EMDASH_INSTANCE_ID: instance.instanceId,
      EMDASH_STATUS_URL: statusUrl,
      EMDASH_TOKEN: instance.token,
    },
    providers,
  };
}

/**
 * Refresh the emdash MCP catalog entry for every provider where it is already
 * installed. No-op if the user has never enabled it.
 */
export async function refreshEmdashCatalogEntry(
  instance: McpInternalInstance,
  statusUrl: string
): Promise<void> {
  let installedProviders: string[] = [];
  try {
    const { installed } = await mcpService.loadAll();
    const existing = installed.find((s) => s.name === EMDASH_MCP_SERVER_NAME);
    installedProviders = existing?.providers ?? [];
  } catch (err) {
    log.warn('mcp-internal: failed to inspect MCP install state', { error: String(err) });
    return;
  }

  if (installedProviders.length === 0) {
    log.info('mcp-internal: emdash MCP not installed for any provider; skipping refresh');
    return;
  }

  const server = buildEmdashServer(instance, statusUrl, installedProviders);
  try {
    await mcpService.saveServer(server);
    log.info('mcp-internal: catalog refreshed', { providers: installedProviders });
  } catch (err) {
    log.error('mcp-internal: failed to refresh catalog entry', { error: String(err) });
  }
}
