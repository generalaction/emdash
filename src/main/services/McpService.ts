import { log } from '../lib/logger';
import { readServers, writeServers } from './mcp/configIO';
import { getAgentMcpMeta, getAllMcpAgentIds } from './mcp/configPaths';
import { adaptForward, adaptReverse } from './mcp/adapters';
import { loadCatalog } from './mcp/catalog';
import type { McpServer, McpLoadAllResponse, ServerMap, RawServerEntry } from '@shared/mcp/types';

export class McpService {
  private _writeLock = Promise.resolve();

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this._writeLock;
    let resolve: () => void;
    this._writeLock = new Promise<void>((r) => {
      resolve = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }

  async loadAll(): Promise<McpLoadAllResponse> {
    return this.withWriteLock(async () => {
      const agentIds = getAllMcpAgentIds();
      const serversByName = new Map<string, { server: McpServer; providers: Set<string> }>();

      for (const agentId of agentIds) {
        const meta = getAgentMcpMeta(agentId);
        if (!meta) continue;

        let rawServers: ServerMap;
        try {
          rawServers = await readServers(meta);
        } catch (err) {
          log.warn(`Failed to read MCP config for ${agentId}:`, err);
          continue;
        }

        // Reverse-adapt to canonical raw format
        const canonical = adaptReverse(meta.adapter, rawServers);

        for (const [name, raw] of Object.entries(canonical)) {
          const existing = serversByName.get(name);
          if (existing) {
            existing.providers.add(agentId);
            // Keep richest config (more keys = richer)
            const newServer = rawToMcpServer(name, raw, existing.providers);
            const existingKeyCount = Object.keys(rawEntryToMcpFields(existing.server)).length;
            const newKeyCount = Object.keys(rawEntryToMcpFields(newServer)).length;
            if (newKeyCount > existingKeyCount) {
              existing.server = newServer;
            }
          } else {
            const providers = new Set([agentId]);
            serversByName.set(name, {
              server: rawToMcpServer(name, raw, providers),
              providers,
            });
          }
        }
      }

      const installed: McpServer[] = [];
      for (const { server, providers } of serversByName.values()) {
        server.providers = Array.from(providers);
        installed.push(server);
      }

      const catalog = loadCatalog();

      return { installed, catalog };
    });
  }

  async saveServer(server: McpServer): Promise<void> {
    if (!server.name || !/^[\w\-._]+$/.test(server.name)) {
      throw new Error(`Invalid server name: "${server.name}"`);
    }
    return this.withWriteLock(async () => {
      const allAgentIds = getAllMcpAgentIds();
      const selectedProviders = new Set(server.providers);
      const raw = mcpServerToRaw(server);

      const failures: string[] = [];

      for (const agentId of allAgentIds) {
        const meta = getAgentMcpMeta(agentId);
        if (!meta) continue;

        let existing: ServerMap;
        try {
          existing = await readServers(meta);
        } catch {
          existing = {};
        }

        if (selectedProviders.has(agentId)) {
          // Add/update: forward-adapt the single server and merge into existing
          const adapted = adaptForward(meta.adapter, { [server.name]: raw });
          const adaptedEntry = adapted[server.name];
          if (adaptedEntry) {
            existing[server.name] = adaptedEntry;
          }
        } else if (server.name in existing) {
          // Remove from deselected provider
          delete existing[server.name];
        } else {
          continue; // no change needed
        }

        try {
          await writeServers(meta, existing);
        } catch (err) {
          log.error(`Failed to write MCP config for ${agentId}:`, err);
          failures.push(agentId);
        }
      }

      if (failures.length) {
        throw new Error(`Failed to write config for: ${failures.join(', ')}`);
      }
    });
  }

  async removeServer(serverName: string): Promise<void> {
    return this.withWriteLock(async () => {
      const allAgentIds = getAllMcpAgentIds();
      const failures: string[] = [];

      for (const agentId of allAgentIds) {
        const meta = getAgentMcpMeta(agentId);
        if (!meta) continue;

        let existing: ServerMap;
        try {
          existing = await readServers(meta);
        } catch {
          continue;
        }

        if (!(serverName in existing)) continue;

        delete existing[serverName];

        try {
          await writeServers(meta, existing);
        } catch (err) {
          log.error(`Failed to write MCP config for ${agentId}:`, err);
          failures.push(agentId);
        }
      }

      if (failures.length) {
        throw new Error(`Failed to write config for: ${failures.join(', ')}`);
      }
    });
  }
}

// ── Conversion helpers ─────────────────────────────────────────────────────

function rawToMcpServer(name: string, raw: RawServerEntry, providers: Set<string>): McpServer {
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

function mcpServerToRaw(server: McpServer): RawServerEntry {
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

function rawEntryToMcpFields(server: McpServer): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (server.command) fields.command = server.command;
  if (server.args?.length) fields.args = server.args;
  if (server.url) fields.url = server.url;
  if (server.headers) fields.headers = server.headers;
  if (server.env) fields.env = server.env;
  return fields;
}

export const mcpService = new McpService();
