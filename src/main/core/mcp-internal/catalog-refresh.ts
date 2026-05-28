import { join } from 'node:path';
import { app } from 'electron';
import { setRuntimeCatalogConfig } from '@main/core/mcp/runtime-catalog';
import { mcpService } from '@main/core/mcp/services/McpService';
import { log } from '@main/lib/logger';
import type { McpServer, RawServerEntry } from '@shared/mcp/types';
import type { McpInternalInstance } from './instance';

export const EMDASH_MCP_SERVER_NAME = 'emdash';

export const EMDASH_MCP_PASSTHROUGH_ENV = [
  'EMDASH_SESSION_ID',
  'EMDASH_TASK_ID',
  'EMDASH_PROJECT_ID',
] as const;

function resolveMcpServerScript(): string {
  const appPath = app.getAppPath();
  const root = app.isPackaged ? appPath.replace('app.asar', 'app.asar.unpacked') : appPath;
  return join(root, 'out', 'mcp-server', 'index.cjs');
}

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
    passthroughEnv: [...EMDASH_MCP_PASSTHROUGH_ENV],
    providers,
  };
}

export function buildEmdashRawConfig(
  instance: McpInternalInstance,
  statusUrl: string
): RawServerEntry {
  const server = buildEmdashServer(instance, statusUrl, []);
  return {
    command: server.command,
    args: server.args,
    env: server.env,
    passthroughEnv: server.passthroughEnv,
  };
}

export async function refreshEmdashCatalogEntry(
  instance: McpInternalInstance,
  statusUrl: string
): Promise<void> {
  setRuntimeCatalogConfig(EMDASH_MCP_SERVER_NAME, buildEmdashRawConfig(instance, statusUrl));

  let installedProviders: string[] = [];
  try {
    const { installed } = await mcpService.loadAll();
    installedProviders =
      installed.find((server) => server.name === EMDASH_MCP_SERVER_NAME)?.providers ?? [];
  } catch (error) {
    log.warn('mcp-internal: failed to inspect MCP install state', { error: String(error) });
    return;
  }

  if (!installedProviders.length) return;

  try {
    await mcpService.saveServer(buildEmdashServer(instance, statusUrl, installedProviders));
  } catch (error) {
    log.error('mcp-internal: failed to refresh MCP config', { error: String(error) });
  }
}
