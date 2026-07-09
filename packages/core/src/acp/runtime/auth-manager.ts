import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Result } from '@emdash/shared';
import { ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { LiveLog } from '@emdash/wire';
import type { AgentAuthMethod, AgentAuthStatus, PluginFs } from '../../agents/plugins';
import { PtyRegistry } from '../../pty';
import type { PtySpawner } from '../../pty';
import type { AuthStatusModelState } from '../api/contract';
import type { AcpRuntimeError } from '../errors';
import { acpErr } from '../errors';
import {
  createAcpAuthStatusLiveHost,
  createAuthStatusModel,
  publishLiveModelState,
  type AcpAuthStatusLiveHost,
  type AuthStatusModel,
} from '../state/live-models';
import type { AcpProcessHost } from '../transport';
import type { ResolveAuthProvider } from './types';

const CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;
const execFileAsync = promisify(execFile);

type CacheEntry = {
  status: AgentAuthStatus;
  checkedAt: number;
};

export interface AcpAuthManagerOptions {
  resolveAuthProvider?: ResolveAuthProvider;
  host: Pick<AcpProcessHost, 'resolveSpawnContext'>;
  ptySpawner?: PtySpawner;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  logger: Logger;
}

export class AcpAuthManager {
  readonly host: AcpAuthStatusLiveHost = createAcpAuthStatusLiveHost();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<AgentAuthStatus>>();
  private readonly ptys: PtyRegistry;
  private readonly seenUrls = new Map<string, Set<string>>();

  constructor(private readonly options: AcpAuthManagerOptions) {
    this.ptys = new PtyRegistry(assertPtySpawner(options.ptySpawner), {
      onSessionChanged: (providerId) => this.publishLoginExit(providerId),
    });
  }

  async getStatus(
    providerId: string,
    options: { refresh?: boolean } = {}
  ): Promise<AgentAuthStatus> {
    this.ensureModel(providerId);
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

  async refreshAuthStatus(providerId: string): Promise<Result<AgentAuthStatus, AcpRuntimeError>> {
    return ok(await this.getStatus(providerId, { refresh: true }));
  }

  async startLogin(providerId: string, methodId: string): Promise<Result<void, AcpRuntimeError>> {
    try {
      const { command, args } = await this.resolveLoginCommand(providerId, methodId);
      const spawnContext = await this.options.host.resolveSpawnContext(providerId);
      const env = this.buildLoginEnv(spawnContext.agentEnv);
      const startedAt = Date.now();
      this.seenUrls.set(providerId, new Set());
      this.publish(providerId, (current) => ({
        ...current,
        login: {
          methodId,
          startedAt,
          pendingUrl: null,
          exit: null,
        },
      }));

      await this.ptys.create(
        providerId,
        {
          command,
          args,
          cwd: this.homeDir(),
          env,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
        },
        {
          onData: (chunk) => this.detectUrl(providerId, chunk),
          onExit: () => {
            void this.getStatus(providerId, { refresh: true }).catch((error) => {
              this.options.logger.warn('AcpAuthManager: failed to refresh auth after login exit', {
                providerId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          },
        }
      );
      return ok();
    } catch (error) {
      return acpErr.invalidState(error instanceof Error ? error.message : String(error));
    }
  }

  cancelLogin(providerId: string): Result<void, AcpRuntimeError> {
    this.ptys.dispose(providerId);
    this.publish(providerId, (current) => ({ ...current, login: null }));
    return ok();
  }

  sendLoginInput(providerId: string, data: string): Result<void, AcpRuntimeError> {
    if (!this.ptys.write(providerId, data)) {
      return acpErr.invalidState(`No login PTY is active for provider '${providerId}'`);
    }
    return ok();
  }

  resizeLogin(providerId: string, cols: number, rows: number): Result<void, AcpRuntimeError> {
    if (!this.ptys.resize(providerId, cols, rows)) {
      return acpErr.invalidState(`No login PTY is active for provider '${providerId}'`);
    }
    return ok();
  }

  markUrlHandled(providerId: string, urlId: string): Result<void, AcpRuntimeError> {
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
    this.ptys.killAll();
    this.host.dispose();
  }

  private async probe(providerId: string): Promise<AgentAuthStatus> {
    const provider = this.options.resolveAuthProvider?.(providerId);
    if (!provider?.behavior || provider.auth.kind === 'none') return { kind: 'unknown' };

    try {
      const spawnContext = await this.options.host.resolveSpawnContext(providerId);
      const env = this.buildLoginEnv(spawnContext.agentEnv);
      return await provider.behavior.checkStatus({
        cli: spawnContext.cli,
        exec: (command, args, opts) => execWithEnv(command, args, opts, env),
        fs: createPluginFs(this.homeDir()),
        env,
      });
    } catch (error) {
      this.options.logger.warn('AcpAuthManager: status probe failed', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'unknown' };
    }
  }

  private async resolveLoginCommand(
    providerId: string,
    methodId: string
  ): Promise<{ command: string; args: string[]; method: AgentAuthMethod }> {
    const provider = this.options.resolveAuthProvider?.(providerId);
    if (!provider) {
      throw new Error(`Provider '${providerId}' was not found`);
    }
    const spawnContext = await this.options.host.resolveSpawnContext(providerId);

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

  private publishLoginExit(providerId: string): void {
    const session = this.ptys.get(providerId);
    if (!session?.exitStatus) return;
    this.publish(providerId, (current) => {
      if (!current.login) return current;
      return {
        ...current,
        login: {
          ...current.login,
          exit: session.exitStatus,
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

  private ensureModel(providerId: string): AuthStatusModel {
    const existing = this.host.get({ providerId });
    if (existing) return existing;
    return createAuthStatusModel(this.host, providerId);
  }

  private publish(
    providerId: string,
    update: (current: AuthStatusModelState) => AuthStatusModelState
  ): void {
    const model = this.ensureModel(providerId);
    const current = model.states.status.snapshot().data;
    const next = update(current);
    publishLiveModelState(model.states.status, next, current);
  }

  private buildLoginEnv(agentEnv: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.options.env ?? process.env)) {
      if (value !== undefined) env[key] = value;
    }
    return { ...env, ...agentEnv };
  }

  private homeDir(): string {
    return this.options.homeDir ?? os.homedir();
  }
}

function assertPtySpawner(spawner: PtySpawner | undefined): PtySpawner {
  return {
    spawn(spec) {
      if (!spawner) {
        throw new Error('ACP auth login requires a PTY spawner');
      }
      return spawner.spawn(spec);
    },
  };
}

async function execWithEnv(
  command: string,
  args: string[] = [],
  opts: { timeout?: number; maxBuffer?: number; signal?: AbortSignal } = {},
  env: Record<string, string>
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(command, args, {
    env,
    timeout: opts.timeout,
    maxBuffer: opts.maxBuffer,
    signal: opts.signal,
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

function createPluginFs(root: string): PluginFs {
  const absRoot = resolve(root);

  function resolveSafe(path: string): string {
    const abs = resolve(join(absRoot, path));
    const rootWithSep = absRoot.endsWith(sep) ? absRoot : absRoot + sep;
    const absWithSep = abs.endsWith(sep) ? abs : abs + sep;
    if (!absWithSep.startsWith(rootWithSep) && abs !== absRoot) {
      throw new Error(`Plugin fs: path escape attempt: ${path}`);
    }
    return abs;
  }

  return {
    async read(path: string): Promise<string | null> {
      try {
        return await fs.readFile(resolveSafe(path), 'utf-8');
      } catch (error: unknown) {
        if (isFileNotFoundException(error)) return null;
        throw error;
      }
    },
    async write(path: string, content: string): Promise<void> {
      const abs = resolveSafe(path);
      await fs.mkdir(dirname(abs), { recursive: true });
      const tmpPath = `${abs}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.rename(tmpPath, abs);
      } catch (error: unknown) {
        await fs.rm(tmpPath, { force: true }).catch(() => {});
        throw error;
      }
    },
    async delete(path: string): Promise<void> {
      await fs.rm(resolveSafe(path), { force: true });
    },
    async exists(path: string): Promise<boolean> {
      try {
        await fs.access(resolveSafe(path));
        return true;
      } catch {
        return false;
      }
    },
    async list(path: string): Promise<string[]> {
      try {
        return await fs.readdir(resolveSafe(path));
      } catch {
        return [];
      }
    },
  };
}

function isFileNotFoundException(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;\]]+$/u, '');
}
