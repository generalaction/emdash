import {
  mcpServerFieldCount,
  mcpServerToRegistration,
  registrationToMcpServer,
  type McpServer,
} from '@emdash/core/mcp';
import type { AgentConfigError } from '@emdash/core/workspace-server';
import { err, ok, type Result } from '@emdash/shared';
import type { AgentConfigMcpModel } from '../state/live-models';
import { publishLiveModelState } from '../state/live-models';
import type { AgentConfigRuntimeDeps } from './types';

export class AgentMcpConfigManager {
  private writeLock = Promise.resolve();
  private list: McpServer[] = [];

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly model: AgentConfigMcpModel
  ) {}

  async initialize(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<McpServer[]> {
    const installed = await this.readAll();
    this.publish(installed);
    return installed;
  }

  async saveServer(server: McpServer): Promise<Result<void, AgentConfigError>> {
    if (!server.name || !/^[\w\-._]+$/.test(server.name)) {
      return err({ type: 'invalid-state', message: `Invalid server name: "${server.name}"` });
    }
    return this.withWriteLock(async () => {
      const selectedProviders = new Set(server.providers);
      for (const provider of this.getMcpProviders()) {
        const agentId = provider.metadata.id;
        const behavior = provider.behavior.mcp;
        if (!behavior) continue;
        let regs = await behavior.readServers(this.deps.pluginFs).catch(() => []);
        const idx = regs.findIndex((reg) => reg.name === server.name);
        if (selectedProviders.has(agentId)) {
          const next = mcpServerToRegistration(server);
          if (idx >= 0) regs[idx] = next;
          else regs = [...regs, next];
        } else if (idx >= 0) {
          regs.splice(idx, 1);
        }
        await behavior.writeServers?.(this.deps.pluginFs, regs);
      }
      await this.refresh();
      return ok();
    });
  }

  async removeServer(name: string): Promise<Result<void, AgentConfigError>> {
    return this.withWriteLock(async () => {
      for (const provider of this.getMcpProviders()) {
        const behavior = provider.behavior.mcp;
        if (!behavior) continue;
        await behavior.removeServer?.(this.deps.pluginFs, name);
      }
      await this.refresh();
      return ok();
    });
  }

  async listForAgent(providerId: string): Promise<Result<McpServer[], AgentConfigError>> {
    const provider = this.deps.pluginHost.get(providerId);
    if (!provider) return err({ type: 'unknown-provider', providerId });
    const behavior = provider.behavior.mcp;
    if (!behavior) return ok([]);
    const regs = await behavior.readServers(this.deps.pluginFs);
    return ok(regs.map((reg) => registrationToMcpServer(reg, [providerId])));
  }

  private async readAll(): Promise<McpServer[]> {
    const serversByName = new Map<string, { server: McpServer; providers: Set<string> }>();
    for (const provider of this.getMcpProviders()) {
      const agentId = provider.metadata.id;
      const behavior = provider.behavior.mcp;
      if (!behavior) continue;
      let regs;
      try {
        regs = await behavior.readServers(this.deps.pluginFs);
      } catch (error) {
        this.deps.logger.warn(`Failed to read MCP config for ${agentId}:`, { error });
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
      installed.push({ ...server, providers: Array.from(providers) });
    }
    return installed;
  }

  private getMcpProviders() {
    return this.deps.pluginHost
      .getAll()
      .filter((provider) => provider.capabilities.mcp.kind === 'supported' && provider.behavior.mcp);
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLock;
    let release: () => void;
    this.writeLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  private publish(list: McpServer[]): void {
    const previous = this.list;
    this.list = list;
    publishLiveModelState(this.model.states.list, list, previous);
  }
}

