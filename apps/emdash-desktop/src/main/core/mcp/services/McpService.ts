import os from 'node:os';
import type { McpServerRegistration } from '@emdash/core/agents/plugins';
import { pluginRegistry } from '@emdash/plugins/agents';
import { createPluginFs } from '@main/core/agents/plugin-fs';
import { log } from '@main/lib/logger';
import type { McpLoadAllResponse, McpServer } from '@shared/core/mcp/types';
import { loadCatalog } from '../utils/catalog';
import {
  mcpServerFieldCount,
  mcpServerToRegistration,
  registrationToMcpServer,
} from '../utils/registration';

function getMcpProviders() {
  return pluginRegistry
    .getAll()
    .filter((p) => p.capabilities.mcp.kind === 'supported' && p.behavior.mcp != null);
}

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
      const fs = createPluginFs(os.homedir());
      const providers = getMcpProviders();
      const serversByName = new Map<string, { server: McpServer; providers: Set<string> }>();

      for (const provider of providers) {
        const agentId = provider.metadata.id;
        let regs: McpServerRegistration[];
        try {
          regs = await provider.behavior.mcp!.readServers(fs);
        } catch (err) {
          log.warn(`Failed to read MCP config for ${agentId}:`, err);
          continue;
        }

        for (const reg of regs) {
          const server = registrationToMcpServer(reg, [agentId]);
          const existing = serversByName.get(reg.name);
          if (existing) {
            existing.providers.add(agentId);
            if (mcpServerFieldCount(server) > mcpServerFieldCount(existing.server)) {
              existing.server = server;
            }
          } else {
            serversByName.set(reg.name, { server, providers: new Set([agentId]) });
          }
        }
      }

      const installed: McpServer[] = [];
      for (const { server, providers } of serversByName.values()) {
        server.providers = Array.from(providers);
        installed.push(server);
      }

      return { installed, catalog: loadCatalog() };
    });
  }

  async saveServer(server: McpServer): Promise<void> {
    if (!server.name || !/^[\w\-._]+$/.test(server.name)) {
      throw new Error(`Invalid server name: "${server.name}"`);
    }
    return this.withWriteLock(async () => {
      const fs = createPluginFs(os.homedir());
      const providers = getMcpProviders();
      const selectedProviders = new Set(server.providers);
      const failures: string[] = [];

      for (const provider of providers) {
        const agentId = provider.metadata.id;
        let regs: McpServerRegistration[];
        try {
          regs = await provider.behavior.mcp!.readServers(fs);
        } catch {
          regs = [];
        }

        const idx = regs.findIndex((r) => r.name === server.name);
        if (selectedProviders.has(agentId)) {
          const toWrite = mcpServerToRegistration(server);
          if (idx >= 0) {
            regs[idx] = toWrite;
          } else {
            regs.push(toWrite);
          }
        } else if (idx >= 0) {
          regs.splice(idx, 1);
        } else {
          continue;
        }

        try {
          await provider.behavior.mcp!.writeServers(fs, regs);
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
      const fs = createPluginFs(os.homedir());
      const providers = getMcpProviders();
      const failures: string[] = [];

      for (const provider of providers) {
        const agentId = provider.metadata.id;
        try {
          await provider.behavior.mcp!.removeServer(fs, serverName);
        } catch (err) {
          log.error(`Failed to remove MCP server from ${agentId}:`, err);
          failures.push(agentId);
        }
      }

      if (failures.length) {
        throw new Error(`Failed to remove config for: ${failures.join(', ')}`);
      }
    });
  }

  async listForAgent(agentId: string): Promise<McpServer[]> {
    const fs = createPluginFs(os.homedir());
    const provider = pluginRegistry.get(agentId);
    if (!provider || provider.capabilities.mcp.kind !== 'supported' || !provider.behavior.mcp) {
      return [];
    }
    try {
      const regs: McpServerRegistration[] = await provider.behavior.mcp.readServers(fs);
      return regs.map((r) => registrationToMcpServer(r, [agentId]));
    } catch (err) {
      log.warn(`Failed to read MCP config for ${agentId}:`, err);
      return [];
    }
  }
}

export const mcpService = new McpService();
