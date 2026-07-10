import { randomUUID } from 'node:crypto';
import { buildAllowlistedAgentEnv } from '@emdash/core/agents/agent-env';
import type { AgentAuthMethod, AgentAuthStatus } from '@emdash/core/agents/plugins';
import { PtyRegistry, type PtyExitInfo, type PtySession, type PtySpawner } from '@emdash/core/pty';
import type { AgentConfigAuthError, AuthStatusModelState } from '@emdash/core/workspace-server';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import type { LiveLog } from '@emdash/wire';
import { createManagedSource, type ManagedSource, type Scope } from '@emdash/wire/util';
import type { AgentInstallManager } from './install';
import type { AgentConfigRuntimeDeps } from './types';

const CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;

type CacheEntry = {
  status: AgentAuthStatus;
  checkedAt: number;
};

type LoginContext = {
  providerId: string;
  methodId: string;
};

type LoginSession = {
  providerId: string;
  pty: PtySession;
};

export class AgentAuthManager {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<AgentAuthStatus>>();
  private readonly ptys: PtyRegistry;
  private readonly loginSource: ManagedSource<string, LoginSession, LoginContext>;
  private readonly loginLeases = new Map<string, PendingLease<LoginSession>>();
  private readonly seenUrls = new Map<string, Set<string>>();

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly install: AgentInstallManager
  ) {
    this.ptys = new PtyRegistry(assertPtySpawner(deps.ptySpawner), {
      onSessionChanged: (providerId) => this.publishLoginExit(providerId),
    });
    this.loginSource = createManagedSource<string, LoginSession, LoginContext>({
      key: (providerId) => providerId,
      create: (providerId, context, scope) => this.createLoginSession(providerId, context, scope),
      onError: (error, providerId) => {
        deps.logger.warn('AgentAuthManager: login PTY creation failed', {
          providerId,
          error: errorMessage(error),
        });
      },
    });
  }

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
        this.updateStatus(providerId, status);
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
    this.updateStatus(providerId, status);
    return status;
  }

  async refreshAuthStatus(
    providerId: string
  ): Promise<Result<AgentAuthStatus, AgentConfigAuthError>> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    return ok(await this.getStatus(providerId, { refresh: true }));
  }

  async startLogin(providerId: string, methodId: string): Promise<Result<void, AgentConfigAuthError>> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    await this.releaseLogin(providerId);
    const lease = this.loginSource.acquire(providerId, { providerId, methodId });
    this.loginLeases.set(providerId, lease);
    try {
      await lease.ready();
      return ok();
    } catch (error) {
      if (this.loginLeases.get(providerId) === lease) this.loginLeases.delete(providerId);
      await lease.release();
      return err({ type: 'invalid-state', message: errorMessage(error) });
    }
  }

  cancelLogin(providerId: string): Result<void, AgentConfigAuthError> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    void this.releaseLogin(providerId);
    this.publish(providerId, (current) => ({ ...current, login: null }));
    return ok();
  }

  sendLoginInput(providerId: string, data: string): Result<void, AgentConfigAuthError> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    if (!this.ptys.write(providerId, data)) {
      return err({
        type: 'invalid-state',
        message: `No login PTY is active for provider '${providerId}'`,
      });
    }
    return ok();
  }

  resizeLogin(
    providerId: string,
    cols: number,
    rows: number
  ): Result<void, AgentConfigAuthError> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    if (!this.ptys.resize(providerId, cols, rows)) {
      return err({
        type: 'invalid-state',
        message: `No login PTY is active for provider '${providerId}'`,
      });
    }
    return ok();
  }

  markUrlHandled(providerId: string, urlId: string): Result<void, AgentConfigAuthError> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    this.publish(providerId, (current) => {
      if (current.login?.pendingUrl?.id !== urlId) return current;
      return {
        ...current,
        login: {
          ...current.login,
          pendingUrl: null,
        },
      };
    });
    return ok();
  }

  loginOutput(providerId: string): LiveLog | null {
    return this.ptys.getLog(providerId);
  }

  dispose(): void {
    void this.loginSource.dispose();
    this.loginLeases.clear();
    this.ptys.killAll();
  }

  private async createLoginSession(
    providerId: string,
    context: LoginContext,
    scope: Scope
  ): Promise<LoginSession> {
    const { command, args } = await this.resolveLoginCommand(providerId, context.methodId);
    const spawnContext = await this.resolveSpawnContext(providerId);
    const env = this.buildLoginEnv(spawnContext.agentEnv);
    const startedAt = Date.now();
    this.seenUrls.set(providerId, new Set());
    this.publish(providerId, (current) => ({
      ...current,
      login: {
        methodId: context.methodId,
        startedAt,
        pendingUrl: null,
        exit: null,
      },
    }));

    const pty = await this.ptys.create(
      providerId,
      {
        command,
        args,
        cwd: this.deps.homeDir,
        env,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      },
      {
        onData: (chunk) => this.detectUrl(providerId, chunk),
        onExit: (info) => {
          this.publishLoginExit(providerId, info);
          void this.getStatus(providerId, { refresh: true }).catch((error) => {
            this.deps.logger.warn('AgentAuthManager: failed to refresh auth after login exit', {
              providerId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          void this.releaseLogin(providerId);
        },
      }
    );
    scope.add(() => {
      this.ptys.dispose(providerId);
      this.seenUrls.delete(providerId);
    });
    return { providerId, pty };
  }

  private async releaseLogin(providerId: string): Promise<void> {
    const lease = this.loginLeases.get(providerId);
    this.loginLeases.delete(providerId);
    if (lease) {
      await lease.release();
      return;
    }
    await this.loginSource.invalidate(providerId);
  }

  private async probe(providerId: string): Promise<AgentAuthStatus> {
    const provider = this.deps.pluginHost.resolveAuthProvider(providerId);
    if (!provider?.behavior || provider.auth.kind === 'none') return { kind: 'unknown' };

    try {
      const spawnContext = await this.resolveSpawnContext(providerId);
      const env = this.buildLoginEnv(spawnContext.agentEnv);
      return await provider.behavior.checkStatus({
        cli: spawnContext.cli,
        exec: (command, args, opts) => this.deps.exec.exec(command, args, opts),
        fs: this.deps.pluginFs,
        env,
      });
    } catch (error) {
      this.deps.logger.warn('AgentAuthManager: status probe failed', {
        providerId,
        error: errorMessage(error),
      });
      return { kind: 'unknown' };
    }
  }

  private async resolveLoginCommand(
    providerId: string,
    methodId: string
  ): Promise<{ command: string; args: string[]; method: AgentAuthMethod }> {
    const provider = this.deps.pluginHost.resolveAuthProvider(providerId);
    if (!provider) throw new Error(`Provider '${providerId}' was not found`);

    const spawnContext = await this.resolveSpawnContext(providerId);
    if (provider.auth.kind === 'none') {
      if (methodId !== 'cli-login') {
        throw new Error(`Auth method '${methodId}' was not found for provider '${providerId}'`);
      }
      return {
        command: spawnContext.cli,
        args: [],
        method: {
          kind: 'cli-login',
          id: 'cli-login',
          name: `Sign in with ${provider.name}`,
          args: [],
        },
      };
    }

    const method = provider.auth.methods.find((candidate) => candidate.id === methodId);
    if (!method) {
      throw new Error(`Auth method '${methodId}' was not found for provider '${providerId}'`);
    }
    if (method.kind !== 'cli-login') {
      throw new Error(`Auth method '${methodId}' is not a CLI login method`);
    }

    const override = provider.behavior?.buildLoginCommand?.({ cli: spawnContext.cli }, methodId);
    return {
      command: override?.command ?? spawnContext.cli,
      args: override?.args ?? method.args,
      method,
    };
  }

  private detectUrl(providerId: string, chunk: string): void {
    const match = URL_PATTERN.exec(chunk);
    if (!match) return;

    const url = stripTrailingUrlPunctuation(match[0]);
    const seen = this.seenUrls.get(providerId) ?? new Set<string>();
    if (seen.has(url)) return;
    seen.add(url);
    this.seenUrls.set(providerId, seen);

    this.publish(providerId, (current) => {
      if (!current.login || current.login.pendingUrl) return current;
      return {
        ...current,
        login: {
          ...current.login,
          pendingUrl: { id: randomUUID(), url },
        },
      };
    });
  }

  private publishLoginExit(providerId: string, exitStatus?: PtyExitInfo): void {
    const exit = exitStatus ?? this.ptys.get(providerId)?.exitStatus;
    if (!exit) return;
    this.publish(providerId, (current) => {
      if (!current.login) return current;
      return {
        ...current,
        login: {
          ...current.login,
          exit,
        },
      };
    });
  }

  private updateStatus(providerId: string, status: AgentAuthStatus): void {
    this.cache.set(providerId, { status, checkedAt: Date.now() });
    this.publish(providerId, (current) => ({
      status,
      login: status.kind === 'authenticated' ? null : current.login,
    }));
  }

  private publish(
    providerId: string,
    update: (current: AuthStatusModelState) => AuthStatusModelState
  ): void {
    const current = this.install.getAuth(providerId);
    this.install.updateAuth(providerId, update(current));
  }

  private buildLoginEnv(agentEnv: Record<string, string>): Record<string, string> {
    return { ...agentEnv };
  }

  private async resolveSpawnContext(providerId: string) {
    if (this.deps.resolveSpawnContext) return this.deps.resolveSpawnContext(providerId);
    return {
      cli: await this.install.resolveCli(providerId),
      agentEnv: buildAllowlistedAgentEnv(this.deps.env ?? {}, {
        homeDir: this.deps.homeDir,
        includeShellVar: true,
      }),
    };
  }

  private hasProvider(providerId: string): boolean {
    return this.deps.pluginHost.get(providerId) !== undefined;
  }
}

function assertPtySpawner(spawner: PtySpawner | undefined): PtySpawner {
  return {
    spawn(spec) {
      if (!spawner) throw new Error('Agent auth login requires a PTY spawner');
      return spawner.spawn(spec);
    },
  };
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;\]]+$/u, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

