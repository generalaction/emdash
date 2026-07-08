import os from 'node:os';
import type { AgentAuthMethod, AgentAuthStatus } from '@emdash/core/agents/plugins';
import type { DependencyId } from '@emdash/core/deps/runtime';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { agentAuthStatusChangedChannel } from '@shared/core/agents/agentEvents';
import { resolveAgentExecutable } from '../conversations/impl/resolve-agent-executable';
import { getDependencyManager, localDependencyManager } from '../dependencies/dependency-managers';
import { hostDependencyStore } from '../dependencies/host-dependency-store';
import { LocalExecutionContext } from '../execution-context/local-execution-context';
import { spawnLocalPty } from '../pty/local-pty';
import { buildAgentEnv, buildTerminalEnv } from '../pty/pty-env';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '../pty/pty-spawn-platform';
import { getTerminalColorEnv } from '../pty/terminal-color-scheme';
import { createPluginFs } from './plugin-fs';
import { getPlugin } from './plugin-registry';

const CACHE_TTL_MS = 15 * 60 * 1000;

type CacheEntry = {
  status: AgentAuthStatus;
  checkedAt: number;
};

class AgentAuthService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<AgentAuthStatus>>();

  async getStatus(
    providerId: string,
    options: { refresh?: boolean } = {}
  ): Promise<AgentAuthStatus> {
    if (!options.refresh) {
      const cached = this.cache.get(providerId);
      if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached.status;
    }

    const pending = this.pending.get(providerId);
    if (pending) return pending;

    const promise = this.probe(providerId)
      .then((status) => {
        this.updateCache(providerId, status);
        return status;
      })
      .finally(() => {
        this.pending.delete(providerId);
      });
    this.pending.set(providerId, promise);
    return promise;
  }

  markUnauthenticated(providerId: string, message?: string): AgentAuthStatus {
    const status: AgentAuthStatus = { kind: 'unauthenticated', message };
    this.updateCache(providerId, status);
    return status;
  }

  async resolveCli(providerId: string): Promise<string> {
    const plugin = getPlugin(providerId);
    const binaryName = plugin.capabilities.hostDependency.binaryNames[0] ?? providerId;
    const mgr = await getDependencyManager();
    const state =
      mgr.get(providerId as DependencyId) ?? localDependencyManager.get(providerId as DependencyId);
    return resolveAgentExecutable({
      providerId,
      binaryName,
      ctx: new LocalExecutionContext(),
      hostDependencyStore,
      cachedStatePath: state?.path ?? null,
    });
  }

  async resolveLoginCommand(
    providerId: string,
    methodId: string
  ): Promise<{ command: string; args: string[]; method: AgentAuthMethod }> {
    const plugin = getPlugin(providerId);
    const auth = plugin.capabilities.auth;
    const cli = await this.resolveCli(providerId);

    if (auth.kind === 'none') {
      if (methodId !== 'cli-login') {
        throw new Error(`Auth method '${methodId}' was not found for provider '${providerId}'`);
      }
      return {
        command: cli,
        args: [],
        method: {
          kind: 'cli-login',
          id: 'cli-login',
          name: `Sign in with ${plugin.metadata.name}`,
          args: [],
        },
      };
    }

    const method = auth.methods.find((candidate) => candidate.id === methodId);
    if (!method) {
      throw new Error(`Auth method '${methodId}' was not found for provider '${providerId}'`);
    }
    if (method.kind !== 'cli-login') {
      throw new Error(`Auth method '${methodId}' is not a CLI login method`);
    }

    const override = plugin.behavior.auth?.buildLoginCommand?.({ cli }, methodId);
    return { command: override?.command ?? cli, args: override?.args ?? method.args, method };
  }

  async startCliLogin(providerId: string, methodId: string): Promise<{ sessionId: string }> {
    const { command, args } = await this.resolveLoginCommand(providerId, methodId);
    const sessionId = loginSessionId(providerId);

    const existing = ptySessionRegistry.get(sessionId);
    if (existing) {
      existing.kill();
      ptySessionRegistry.unregister(sessionId);
    }

    const intent = {
      kind: 'run-command' as const,
      cwd: os.homedir(),
      command: { kind: 'argv' as const, command, args },
    };
    const resolved = resolveLocalPtySpawn({
      platform: process.platform,
      env: process.env,
      intent,
    });

    logLocalPtySpawnWarnings('AgentAuthService', resolved.warnings, {
      providerId,
      sessionId,
    });

    const pty = spawnLocalPty({
      id: sessionId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: {
        ...buildTerminalEnv(),
        ...(await getTerminalColorEnv()),
      },
      cols: 120,
      rows: 30,
    });

    pty.onExit(() => {
      void this.getStatus(providerId, { refresh: true }).catch((error) => {
        log.warn('AgentAuthService: failed to refresh auth status after login PTY exit', {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    ptySessionRegistry.register(sessionId, pty, {
      preserveBufferOnExit: true,
      metadata: {
        providerId,
        title: 'Agent sign-in',
      },
    });

    return { sessionId };
  }

  private async probe(providerId: string): Promise<AgentAuthStatus> {
    const plugin = getPlugin(providerId);
    const behavior = plugin.behavior.auth;
    if (!behavior || plugin.capabilities.auth.kind === 'none') return { kind: 'unknown' };

    try {
      const cli = await this.resolveCli(providerId);
      const ctx = new LocalExecutionContext();
      try {
        return await behavior.checkStatus({
          cli,
          exec: ctx.exec.bind(ctx),
          fs: createPluginFs(os.homedir()),
          env: buildAgentEnv({ agentApiVars: true }),
        });
      } finally {
        ctx.dispose();
      }
    } catch (error) {
      log.warn('AgentAuthService: status probe failed', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'unknown' };
    }
  }

  private updateCache(providerId: string, status: AgentAuthStatus): void {
    const previous = this.cache.get(providerId)?.status;
    this.cache.set(providerId, { status, checkedAt: Date.now() });
    if (!sameStatus(previous, status)) {
      events.emit(agentAuthStatusChangedChannel, { providerId, status });
    }
  }
}

function sameStatus(a: AgentAuthStatus | undefined, b: AgentAuthStatus): boolean {
  return a?.kind === b.kind && accountOf(a) === accountOf(b) && messageOf(a) === messageOf(b);
}

function accountOf(status: AgentAuthStatus | undefined): string | undefined {
  return status?.kind === 'authenticated' ? status.account : undefined;
}

function messageOf(status: AgentAuthStatus | undefined): string | undefined {
  return status?.kind === 'unauthenticated' || status?.kind === 'unknown'
    ? status.message
    : undefined;
}

export const agentAuthService = new AgentAuthService();

function loginSessionId(providerId: string): string {
  return `agent-auth:${providerId}`;
}
