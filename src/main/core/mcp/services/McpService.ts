import type { McpLoadAllResponse, McpServer, ServerMap } from '@shared/mcp/types';
import { log } from '@main/lib/logger';
import { adaptForward, adaptReverse } from '../utils/adapters';
import { loadCatalog } from '../utils/catalog';
import { readServers, writeServers } from '../utils/config-io';
import { getAgentMcpMeta, getAllMcpAgentIds } from '../utils/config-paths';
import { mcpServerToRaw, rawEntryToMcpFields, rawToMcpServer } from '../utils/conversion';

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

        const canonical = adaptReverse(meta.adapter, rawServers);

        for (const [name, raw] of Object.entries(canonical)) {
          const existing = serversByName.get(name);
          if (existing) {
            existing.providers.add(agentId);

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
          const adapted = adaptForward(meta.adapter, { [server.name]: raw });
          const adaptedEntry = adapted[server.name];
          if (adaptedEntry) {
            existing[server.name] = adaptedEntry;
          }
        } else if (server.name in existing) {
          delete existing[server.name];
        } else {
          continue;
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

export const mcpService = new McpService();
