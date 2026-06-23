import type { McpServerRegistration } from '@emdash/core/agents/plugins';
import type { McpServer } from '@shared/core/mcp/types';

/** Convert a plugin registration to the canonical desktop McpServer shape. */
export function registrationToMcpServer(
  reg: McpServerRegistration,
  providers: string[]
): McpServer {
  const isHttp =
    reg.transport === 'http' ||
    reg.type === 'http' ||
    (typeof reg.url === 'string' && typeof reg.command !== 'string');
  return {
    name: reg.name,
    transport: isHttp ? 'http' : 'stdio',
    command: typeof reg.command === 'string' ? reg.command : undefined,
    args: Array.isArray(reg.args) ? (reg.args as string[]) : undefined,
    url: typeof reg.url === 'string' ? reg.url : undefined,
    headers:
      typeof reg.headers === 'object' && reg.headers !== null
        ? (reg.headers as Record<string, string>)
        : undefined,
    env:
      typeof reg.env === 'object' && reg.env !== null
        ? (reg.env as Record<string, string>)
        : undefined,
    enabled: typeof reg.enabled === 'boolean' ? reg.enabled : undefined,
    cwd: typeof reg.cwd === 'string' ? reg.cwd : undefined,
    timeout: typeof reg.timeout === 'number' ? reg.timeout : undefined,
    oauth:
      (typeof reg.oauth === 'object' && reg.oauth !== null) || reg.oauth === false
        ? (reg.oauth as Record<string, unknown> | false)
        : undefined,
    providers,
  };
}

/** Convert a canonical desktop McpServer to the plugin registration shape. */
export function mcpServerToRegistration(server: McpServer): McpServerRegistration {
  return {
    name: server.name,
    transport: server.transport,
    // Adapters that detect HTTP via `type` field (gemini, opencode) need this set
    ...(server.transport === 'http' ? { type: 'http' as const } : {}),
    command: server.command,
    args: server.args,
    url: server.url,
    headers: server.headers,
    env: server.env,
    enabled: server.enabled,
    cwd: server.cwd,
    timeout: server.timeout,
    oauth: server.oauth,
  };
}

/**
 * Count the meaningful payload fields of an McpServer (used for merge conflict
 * resolution: prefer the entry that carries more information).
 */
export function mcpServerFieldCount(server: McpServer): number {
  let n = 0;
  if (server.command) n += 10;
  if (server.args?.length) n++;
  if (server.url) n += 10;
  if (server.headers && Object.keys(server.headers).length) n++;
  if (server.env && Object.keys(server.env).length) n++;
  if (server.enabled !== undefined) n++;
  if (server.cwd) n++;
  if (server.timeout !== undefined) n++;
  if (server.oauth !== undefined) n++;
  return n;
}
