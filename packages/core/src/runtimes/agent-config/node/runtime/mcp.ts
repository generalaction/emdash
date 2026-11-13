import { err, ok, type Result } from '@emdash/shared';
import {
  mcpServerFieldCount,
  mcpServerToRegistration,
  registrationToMcpServer,
  type McpServer,
} from '#primitives/mcp/api';
import type { AgentConfigMcpError } from '#runtimes/agent-config/api';
import type { AgentConfigMcpModel } from '#runtimes/agent-config/node/state/live-models';
import { publishLiveModelState } from '#runtimes/agent-config/node/state/live-models';
import type { ProviderEnvCache } from './provider-env-cache';
import type { AgentConfigRuntimeDeps } from './types';

export class AgentMcpConfigManager {
  private writeLock = Promise.resolve();
  private list: McpServer[] = [];
  /**
   * The env each provider's config was read with for the currently published
   * list. Cross-provider writes (save/remove) target these, so an edit always
   * lands in the config root the user is looking at, even if the shared env
   * cache has since moved on and the follow-up refresh hasn't published yet.
   */
  private listedEnv = new Map<string, Record<string, string> | undefined>();
  private refreshGeneration = 0;
  private readonly unsubscribeEnv: () => void;

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly model: AgentConfigMcpModel,
    private readonly providerEnv: ProviderEnvCache
  ) {
    // A provider's config root can move (e.g. hooksStatus learns a configured
    // CLAUDE_CONFIG_DIR after startup); republish so the list matches it.
    this.unsubscribeEnv = providerEnv.onChange(() => {
      void this.refresh().catch((error: unknown) => {
        this.deps.logger.warn('Failed to refresh MCP config after env change', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  async initialize(): Promise<void> {
    await this.refresh();
  }

  dispose(): void {
    this.unsubscribeEnv();
  }

  async refresh(): Promise<McpServer[]> {
    const generation = ++this.refreshGeneration;
    const { installed, envs } = await this.readAll();
    // Overlapping refreshes: only the most recently started one publishes.
    if (generation === this.refreshGeneration) {
      this.listedEnv = envs;
      this.publish(installed);
    }
    return installed;
  }

  async saveServer(server: McpServer): Promise<Result<void, AgentConfigMcpError>> {
    if (!server.name || !/^[\w\-._]+$/.test(server.name)) {
      return err({ type: 'invalid-state', message: `Invalid server name: "${server.name}"` });
    }
    for (const providerId of server.providers) {
      if (!this.deps.agentHost.get(providerId))
        return err({ type: 'unknown-provider', providerId });
    }
    try {
      return await this.withWriteLock(async () => {
        const selectedProviders = new Set(server.providers);
        for (const provider of this.getMcpProviders()) {
          const agentId = provider.metadata.id;
          const env = this.writeEnv(agentId);
          const read = await this.deps.agentHost.readMcpServers(agentId, env);
          let regs = read.success ? read.data : [];
          const idx = regs.findIndex((reg) => reg.name === server.name);
          if (selectedProviders.has(agentId)) {
            const next = mcpServerToRegistration(server);
            if (idx >= 0) regs[idx] = next;
            else regs = [...regs, next];
          } else if (idx >= 0) {
            regs.splice(idx, 1);
          }
          const write = await this.deps.agentHost.writeMcpServers(agentId, regs, env);
          if (!write.success) throw new Error(agentHostErrorMessage(write.error));
        }
        await this.refresh();
        return ok();
      });
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async removeServer(name: string): Promise<Result<void, AgentConfigMcpError>> {
    try {
      return await this.withWriteLock(async () => {
        for (const provider of this.getMcpProviders()) {
          const agentId = provider.metadata.id;
          const result = await this.deps.agentHost.removeMcpServer(
            agentId,
            name,
            this.writeEnv(agentId)
          );
          if (!result.success) throw new Error(agentHostErrorMessage(result.error));
        }
        await this.refresh();
        return ok();
      });
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async removeServerForAgent(
    providerId: string,
    name: string,
    env?: Record<string, string>
  ): Promise<Result<void, AgentConfigMcpError>> {
    const provider = this.deps.agentHost.get(providerId);
    if (!provider) return err({ type: 'unknown-provider', providerId });
    if (provider.capabilities.mcp.kind !== 'supported' || !provider.behavior.mcp) {
      return err({
        type: 'invalid-state',
        message: `Provider '${providerId}' does not support MCP`,
      });
    }
    // This slice's only real caller (the separate mcp app-slice
    // wire-controller) has no Settings access and always passes env
    // undefined — that's "I don't know", not "the override was cleared", so
    // only overwrite the shared cache when a future caller actually supplies
    // something.
    if (env !== undefined) this.providerEnv.set(providerId, env);

    try {
      return await this.withWriteLock(async () => {
        const result = await this.deps.agentHost.removeMcpServer(
          providerId,
          name,
          this.providerEnv.get(providerId)
        );
        if (!result.success) throw new Error(agentHostErrorMessage(result.error));
        await this.refresh();
        return ok();
      });
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async listForAgent(
    providerId: string,
    env?: Record<string, string>
  ): Promise<Result<McpServer[], AgentConfigMcpError>> {
    const provider = this.deps.agentHost.get(providerId);
    if (!provider) return err({ type: 'unknown-provider', providerId });
    if (provider.capabilities.mcp.kind !== 'supported' || !provider.behavior.mcp) return ok([]);
    // See removeServerForAgent: only an actually-informed caller should update
    // the shared cache here.
    if (env !== undefined) this.providerEnv.set(providerId, env);
    try {
      const result = await this.deps.agentHost.readMcpServers(
        providerId,
        this.providerEnv.get(providerId)
      );
      if (!result.success) return err(toIoError(agentHostErrorMessage(result.error)));
      const regs = result.data;
      return ok(regs.map((reg) => registrationToMcpServer(reg, [providerId])));
    } catch (error) {
      return err(toIoError(error));
    }
  }

  private async readAll(): Promise<{
    installed: McpServer[];
    envs: Map<string, Record<string, string> | undefined>;
  }> {
    const serversByName = new Map<string, { server: McpServer; providers: Set<string> }>();
    const envs = new Map<string, Record<string, string> | undefined>();
    for (const provider of this.getMcpProviders()) {
      const agentId = provider.metadata.id;
      const env = this.providerEnv.get(agentId);
      envs.set(agentId, env);
      const result = await this.deps.agentHost.readMcpServers(agentId, env);
      if (!result.success) {
        this.deps.logger.warn(`Failed to read MCP config for ${agentId}:`, {
          error: agentHostErrorMessage(result.error),
        });
        continue;
      }
      for (const reg of result.data) {
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
    return { installed, envs };
  }

  /** Env of the config root the published list was read from for this provider. */
  private writeEnv(agentId: string): Record<string, string> | undefined {
    return this.listedEnv.has(agentId)
      ? this.listedEnv.get(agentId)
      : this.providerEnv.get(agentId);
  }

  private getMcpProviders() {
    return this.deps.agentHost
      .getAll()
      .filter(
        (provider) => provider.capabilities.mcp.kind === 'supported' && provider.behavior.mcp
      );
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

function toIoError(error: unknown): AgentConfigMcpError {
  return { type: 'io', message: error instanceof Error ? error.message : String(error) };
}

function agentHostErrorMessage(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}
