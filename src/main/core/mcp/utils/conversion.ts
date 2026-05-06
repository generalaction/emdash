import type { McpServer, RawServerEntry } from '@shared/mcp/types';

export function rawToMcpServer(
  name: string,
  raw: RawServerEntry,
  providers: Set<string>
): McpServer {
  const isHttp = raw.type === 'http' || ('url' in raw && !('command' in raw));
  return {
    name,
    transport: isHttp ? 'http' : 'stdio',
    command: typeof raw.command === 'string' ? raw.command : undefined,
    args: Array.isArray(raw.args) ? (raw.args as string[]) : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    headers:
      typeof raw.headers === 'object' && raw.headers !== null
        ? (raw.headers as Record<string, string>)
        : undefined,
    env:
      typeof raw.env === 'object' && raw.env !== null
        ? (raw.env as Record<string, string>)
        : undefined,
    providers: Array.from(providers),
  };
}

export function mcpServerToRaw(server: McpServer): RawServerEntry {
  const raw: RawServerEntry = {};
  if (server.transport === 'http') {
    raw.type = 'http';
    if (server.url) raw.url = server.url;
    if (server.headers && Object.keys(server.headers).length) raw.headers = server.headers;
  } else {
    if (server.command) raw.command = server.command;
    if (server.args?.length) raw.args = server.args;
  }
  if (server.env && Object.keys(server.env).length) raw.env = server.env;
  return raw;
}

export function rawEntryToMcpFields(server: McpServer): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (server.command) fields.command = server.command;
  if (server.args?.length) fields.args = server.args;
  if (server.url) fields.url = server.url;
  if (server.headers) fields.headers = server.headers;
  if (server.env) fields.env = server.env;
  return fields;
}
