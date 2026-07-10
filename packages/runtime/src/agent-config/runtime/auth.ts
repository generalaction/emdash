import { randomUUID } from 'node:crypto';
import type { AgentAuthStatus, AgentHostError } from '@emdash/core/agents/plugins';
import { PtyRegistry, type PtyExitInfo, type PtySession } from '@emdash/core/pty';
import type { AgentConfigAuthError, AuthStatusModelState } from '@emdash/core/workspace-server';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import type { LiveLog } from '@emdash/wire';
import {
  createManagedSource,
  deduplicateRequests,
  type ManagedSource,
  type Scope,
} from '@emdash/wire/util';
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
  generation: string;
};

type LoginSession = {
  providerId: string;
  generation: string;
  pty: PtySession;
  seenUrls: Set<string>;
};

type LoginLease = {
  generation: string;
  lease: PendingLease<LoginSession>;
};

export class AgentAuthManager {
  private readonly scope: Scope;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly statusGenerations = new Map<string, number>();
  private readonly ptys: PtyRegistry;
  private readonly loginSource: ManagedSource<string, LoginSession, LoginContext>;
  private readonly loginLeases = new Map<string, LoginLease>();
  private readonly probeStatus: (providerId: string) => Promise<AgentAuthStatus>;

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly install: AgentInstallManager
  ) {
    this.scope = deps.scope.child('auth');
    this.ptys = new PtyRegistry(deps.ptySpawner);
    this.loginSource = createManagedSource<string, LoginSession, LoginContext>({
      key: (providerId) => providerId,
      scope: this.scope,
      label: 'login-source',
      create: (providerId, context, scope) => this.createLoginSession(providerId, context, scope),
      onError: (error, providerId) => {
        deps.logger.warn('AgentAuthManager: login PTY creation failed', {
          providerId,
          error: errorMessage(error),
        });
      },
    });
    this.probeStatus = deduplicateRequests(
      (providerId: string) => this.probeAndUpdate(providerId),
      { key: (providerId) => providerId }
    );
    this.scope.add(() => {
      this.loginLeases.clear();
      this.cache.clear();
      this.statusGenerations.clear();
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

    return this.probeStatus(providerId);
  }

  markUnauthenticated(providerId: string, message?: string): AgentAuthStatus {
    const status: AgentAuthStatus = { kind: 'unauthenticated', message };
    this.nextStatusGeneration(providerId);
    this.updateStatus(providerId, status);
    return status;
  }

  async refreshAuthStatus(
    providerId: string
  ): Promise<Result<AgentAuthStatus, AgentConfigAuthError>> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    return ok(await this.getStatus(providerId, { refresh: true }));
  }

  async startLogin(
    providerId: string,
    methodId: string
  ): Promise<Result<void, AgentConfigAuthError>> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    await this.releaseLogin(providerId, undefined, { force: true });
    const generation = randomUUID();
    const lease = this.loginSource.acquire(providerId, { providerId, methodId, generation });
    this.loginLeases.set(providerId, { generation, lease });
    try {
      await lease.ready();
      if (!this.isCurrentLogin(providerId, generation)) {
        return err({ type: 'invalid-state', message: 'Login was superseded while starting' });
      }
      return ok();
    } catch (error) {
      if (this.isCurrentLogin(providerId, generation)) this.loginLeases.delete(providerId);
      await lease.release();
      return err({ type: 'invalid-state', message: errorMessage(error) });
    }
  }

  async cancelLogin(providerId: string): Promise<Result<void, AgentConfigAuthError>> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    await this.releaseLogin(providerId, undefined, { force: true });
    this.publish(providerId, (current) => ({ ...current, login: null }));
    return ok();
  }

  sendLoginInput(providerId: string, data: string): Result<void, AgentConfigAuthError> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    const session = this.currentLogin(providerId);
    if (!session) return noLogin(providerId);
    session.pty.write(data);
    return ok();
  }

  resizeLogin(providerId: string, cols: number, rows: number): Result<void, AgentConfigAuthError> {
    if (!this.hasProvider(providerId)) return err({ type: 'unknown-provider', providerId });
    const session = this.currentLogin(providerId);
    if (!session) return noLogin(providerId);
    session.pty.resize(cols, rows);
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
    return this.currentLogin(providerId)?.pty.output ?? null;
  }

  dispose(): Promise<void> {
    return this.scope.dispose();
  }

  private async createLoginSession(
    providerId: string,
    context: LoginContext,
    scope: Scope
  ): Promise<LoginSession> {
    const loginCommand = await this.deps.agentHost.buildLoginCommand(providerId, context.methodId);
    if (!loginCommand.success) throw new Error(agentConfigAuthErrorMessage(loginCommand.error));
    const { command, args, env } = loginCommand.data;
    if (!this.isCurrentLogin(providerId, context.generation)) {
      throw new Error('Login was superseded while resolving the login command');
    }
    const startedAt = Date.now();
    const seenUrls = new Set<string>();
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
        cwd: this.deps.agentHost.homeDir,
        env,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      },
      {
        replaceExisting: false,
        onData: (chunk) => this.detectUrl(providerId, context.generation, seenUrls, chunk),
        onExit: (info) => {
          void this.handleLoginExit(providerId, context.generation, info);
        },
      }
    );
    scope.add(() => {
      if (this.ptys.get(providerId) === pty) this.ptys.dispose(providerId);
    });
    return { providerId, generation: context.generation, pty, seenUrls };
  }

  private async handleLoginExit(
    providerId: string,
    generation: string,
    info: PtyExitInfo
  ): Promise<void> {
    if (!this.isCurrentLogin(providerId, generation)) return;
    this.publishLoginExit(providerId, generation, info);
    await this.releaseLogin(providerId, generation);
    if (this.scope.disposed) return;
    await this.getStatus(providerId, { refresh: true }).catch((error) => {
      this.deps.logger.warn('AgentAuthManager: failed to refresh auth after login exit', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async releaseLogin(
    providerId: string,
    generation?: string,
    options: { force?: boolean } = {}
  ): Promise<void> {
    const entry = this.loginLeases.get(providerId);
    if (entry) {
      if (generation && entry.generation !== generation) return;
      this.loginLeases.delete(providerId);
      if (options.force) await this.loginSource.invalidate(providerId);
      await entry.lease.release();
      return;
    }

    if (!generation || options.force) await this.loginSource.invalidate(providerId);
  }

  private async probeAndUpdate(providerId: string): Promise<AgentAuthStatus> {
    const generation = this.nextStatusGeneration(providerId);
    const status = await this.probe(providerId);
    if (!this.scope.disposed && this.statusGenerations.get(providerId) === generation) {
      this.updateStatus(providerId, status);
    }
    return status;
  }

  private async probe(providerId: string): Promise<AgentAuthStatus> {
    try {
      const status = await this.deps.agentHost.checkAuthStatus(providerId);
      if (!status.success) {
        this.deps.logger.warn('AgentAuthManager: spawn context resolution failed', {
          providerId,
          error: agentConfigAuthErrorMessage(status.error),
        });
        return { kind: 'unknown' };
      }
      return status.data;
    } catch (error) {
      this.deps.logger.warn('AgentAuthManager: status probe failed', {
        providerId,
        error: errorMessage(error),
      });
      return { kind: 'unknown' };
    }
  }

  private detectUrl(
    providerId: string,
    generation: string,
    seenUrls: Set<string>,
    chunk: string
  ): void {
    if (!this.isCurrentLogin(providerId, generation)) return;
    const match = URL_PATTERN.exec(chunk);
    if (!match) return;

    const url = stripTrailingUrlPunctuation(match[0]);
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

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

  private publishLoginExit(providerId: string, generation: string, exit: PtyExitInfo): void {
    if (!this.isCurrentLogin(providerId, generation)) return;
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
    if (this.scope.disposed) return;
    const current = this.install.getAuth(providerId);
    this.install.updateAuth(providerId, update(current));
  }

  private hasProvider(providerId: string): boolean {
    return this.deps.agentHost.get(providerId) !== undefined;
  }

  private currentLogin(providerId: string): LoginSession | null {
    const session = this.loginSource.peek(providerId);
    if (!session || !this.isCurrentLogin(providerId, session.generation)) return null;
    return session;
  }

  private isCurrentLogin(providerId: string, generation: string): boolean {
    return this.loginLeases.get(providerId)?.generation === generation;
  }

  private nextStatusGeneration(providerId: string): number {
    const next = (this.statusGenerations.get(providerId) ?? 0) + 1;
    this.statusGenerations.set(providerId, next);
    return next;
  }
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;\]]+$/u, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function agentConfigAuthErrorMessage(error: AgentConfigAuthError | AgentHostError): string {
  return 'message' in error ? error.message : error.type;
}

function noLogin(providerId: string): Result<void, AgentConfigAuthError> {
  return err({
    type: 'invalid-state',
    message: `No login PTY is active for provider '${providerId}'`,
  });
}
