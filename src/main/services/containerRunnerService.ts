import { EventEmitter } from 'node:events';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

import type { ResolvedContainerConfig, PackageManager } from '@shared/container';
import {
  generateMockStartEvents,
  PortAllocationError,
  PortManager,
  type RunnerEvent,
  type RunnerErrorEvent,
  type RunnerMode,
} from '@shared/container';

import { log } from '../lib/logger';
import {
  ContainerConfigLoadError,
  ContainerConfigLoadResult,
  loadWorkspaceContainerConfig,
} from './containerConfigService';

const RUN_EVENT_CHANNEL = 'runner-event';

function detectPackageManagerFromWorkdir(dir: string): PackageManager | undefined {
  try {
    const pnpmLock = path.join(dir, 'pnpm-lock.yaml');
    const yarnLock = path.join(dir, 'yarn.lock');
    const npmLock = path.join(dir, 'package-lock.json');
    const npmShrinkwrap = path.join(dir, 'npm-shrinkwrap.json');
    if (fs.existsSync(pnpmLock)) return 'pnpm';
    if (fs.existsSync(yarnLock)) return 'yarn';
    if (fs.existsSync(npmLock) || fs.existsSync(npmShrinkwrap)) return 'npm';
  } catch {}
  return undefined;
}

export type ContainerStartErrorCode =
  | 'INVALID_ARGUMENT'
  | ContainerConfigLoadError['code']
  | 'PORT_ALLOC_FAILED'
  | 'UNKNOWN';

export interface ContainerStartError {
  code: ContainerStartErrorCode;
  message: string;
  configPath: string | null;
  configKey: string | null;
}

export interface ContainerStartOptions {
  workspaceId: string;
  workspacePath: string;
  runId?: string;
  mode?: RunnerMode;
  now?: () => number;
}

export interface ContainerStartSuccess {
  ok: true;
  runId: string;
  config: ResolvedContainerConfig;
  sourcePath: string | null;
}

export interface ContainerStartFailure {
  ok: false;
  error: ContainerStartError;
}

export type ContainerStartResult = ContainerStartSuccess | ContainerStartFailure;

export interface ContainerRunnerServiceOptions {
  portAllocator?: Pick<PortManager, 'allocate'>;
}

export class ContainerRunnerService extends EventEmitter {
  private readonly portAllocator: Pick<PortManager, 'allocate'>;
  private readonly startInFlight = new Map<string, Promise<ContainerStartResult>>();

  constructor(options: ContainerRunnerServiceOptions = {}) {
    super();
    this.portAllocator = options.portAllocator ?? new PortManager();
  }

  onRunnerEvent(listener: (event: RunnerEvent) => void): this {
    this.on(RUN_EVENT_CHANNEL, listener);
    return this;
  }

  offRunnerEvent(listener: (event: RunnerEvent) => void): this {
    this.off(RUN_EVENT_CHANNEL, listener);
    return this;
  }

  emitRunnerEvent(event: RunnerEvent): boolean {
    return this.emit(RUN_EVENT_CHANNEL, event);
  }

  /**
   * Start a real container run using the local Docker CLI.
   * Emits runner events compatible with the existing renderer.
   */
  async startRun(options: ContainerStartOptions): Promise<ContainerStartResult> {
    const existing = this.startInFlight.get(options.workspaceId);
    if (existing) return existing;

    const promise = this._startRunImpl(options).finally(() => {
      this.startInFlight.delete(options.workspaceId);
    });
    this.startInFlight.set(options.workspaceId, promise);
    return promise;
  }

  private async _startRunImpl(options: ContainerStartOptions): Promise<ContainerStartResult> {
    const { workspaceId, workspacePath } = options;
    if (!workspaceId || !workspacePath) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: '`workspaceId` and `workspacePath` are required',
          configKey: null,
          configPath: null,
        },
      };
    }

    // Load container config
    const loadResult = await this.loadConfig(workspacePath);
    if (loadResult.ok === false) {
      return {
        ok: false,
        error: this.serializeConfigError(loadResult.error),
      };
    }

    const config = loadResult.config;
    const now = options.now ?? Date.now;
    const runId = options.runId ?? this.generateRunId(now);
    const mode: RunnerMode = options.mode ?? 'container';

    // Currently we only implement container mode here.
    if (mode !== 'container') {
      // Fallback to mock for host mode until implemented
      return this.startMockRun({ ...options, runId, mode });
    }

    const execAsync = promisify(exec);

    const DOCKER_INFO_TIMEOUT_MS = 8000;
    const DOCKER_RUN_TIMEOUT_MS = 2 * 60 * 1000;

    const emitLifecycle = (
      status: 'building' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'
    ) => {
      this.emitRunnerEvent({ ts: now(), workspaceId, runId, mode, type: 'lifecycle', status });
    };

    const emitPorts = (
      ports: Array<{ service: string; container: number; host: number }>,
      previewService: string
    ) => {
      const mapped = ports.map((p) => ({
        service: p.service,
        protocol: 'tcp' as const,
        container: p.container,
        host: p.host,
        url: `http://localhost:${p.host}`,
      }));
      this.emitRunnerEvent({
        ts: now(),
        workspaceId,
        runId,
        mode,
        type: 'ports',
        previewService,
        ports: mapped,
      });
    };

    try {
      // Host-side preflight checks to prevent unintended workspace mutations
      const absWorkspace = path.resolve(workspacePath);
      const workdirAbs = path.resolve(absWorkspace, config.workdir);

      if (!fs.existsSync(workdirAbs)) {
        const message = `Configured workdir does not exist: ${workdirAbs}`;
        const event = {
          ts: now(),
          workspaceId,
          runId,
          mode,
          type: 'error' as const,
          code: 'INVALID_CONFIG' as const,
          message,
        };
        this.emitRunnerEvent(event);
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message,
            configKey: 'workdir',
            configPath: workdirAbs,
          },
        };
      }

      const pkgJsonPath = path.join(workdirAbs, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) {
        const message = `No package.json found in workdir: ${workdirAbs}. Set the correct 'workdir' in .emdash/config.json`;
        this.emitRunnerEvent({
          ts: now(),
          workspaceId,
          runId,
          mode,
          type: 'error',
          code: 'INVALID_CONFIG',
          message,
        });
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message,
            configKey: 'workdir',
            configPath: workdirAbs,
          },
        };
      }

      // Ensure Docker is available
      try {
        log.info('[containers] checking docker availability');
        await execAsync("docker info --format '{{.ServerVersion}}'", {
          timeout: DOCKER_INFO_TIMEOUT_MS,
        });
        log.info('[containers] docker is available');
      } catch (e) {
        const message = 'Docker is not available or not responding. Please start Docker Desktop.';
        const event = {
          ts: now(),
          workspaceId,
          runId,
          mode,
          type: 'error' as const,
          code: 'DOCKER_NOT_AVAILABLE' as const,
          message,
        };
        this.emitRunnerEvent(event);
        return {
          ok: false,
          error: { code: 'UNKNOWN', message, configKey: null, configPath: null },
        };
      }

      // Allocate host ports for requested container ports
      const portRequests = config.ports;
      const allocated = await this.portAllocator.allocate(portRequests);

      const previewService =
        (config.ports.find((p) => p.preview) || config.ports[0])?.service ?? 'app';
      const previewMapping = allocated.find((m) => m.service === previewService);

      emitLifecycle('building');

      // Ensure no leftover container with the same name
      const containerName = `emdash_ws_${workspaceId}`;
      try {
        await execAsync(`docker rm -f ${JSON.stringify(containerName)}`);
      } catch {}

      // Compose docker run args
      const image = 'node:20';
      const dockerArgs: string[] = ['run', '-d', '--name', containerName];

      // Port mappings
      for (const m of allocated) {
        dockerArgs.push('-p', `${m.host}:${m.container}`);
      }

      // Workspace mount and workdir
      dockerArgs.push('-v', `${absWorkspace}:/workspace`);
      const workdir = path.posix.join('/workspace', config.workdir.replace(/\\/g, '/'));
      dockerArgs.push('-w', workdir);

      // Ensure dev servers bind externally
      dockerArgs.push('-e', 'HOST=0.0.0.0');
      if (previewMapping?.container) {
        dockerArgs.push('-e', `PORT=${previewMapping.container}`);
      }

      // Env file (optional)
      if (config.envFile) {
        const envAbs = path.resolve(workspacePath, config.envFile);
        if (!fs.existsSync(envAbs)) {
          const message = `Env file not found: ${envAbs}`;
          this.emitRunnerEvent({
            ts: now(),
            workspaceId,
            runId,
            mode,
            type: 'error',
            code: 'ENVFILE_NOT_FOUND',
            message,
          });
          return {
            ok: false,
            error: { code: 'UNKNOWN', message, configKey: 'envFile', configPath: envAbs },
          };
        }
        dockerArgs.push('--env-file', envAbs);
      }

      // Build command: safe install + start
      // Detect package manager from lockfiles in workdir to avoid wrong PM creating lockfiles.
      const detectedPm = detectPackageManagerFromWorkdir(workdirAbs) ?? config.packageManager;
      const startCmd = config.start;

      let installCmd = '';
      if (detectedPm === 'npm') {
        // Avoid creating package-lock.json on fallback installs
        installCmd =
          'if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi';
      } else if (detectedPm === 'pnpm') {
        // Use frozen lockfile when present; otherwise allow creation per pnpm defaults
        installCmd =
          'corepack enable && if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi';
      } else if (detectedPm === 'yarn') {
        // Yarn v1 supports --frozen-lockfile; for others we fall back to plain install
        installCmd =
          'corepack enable && if [ -f yarn.lock ]; then yarn install --frozen-lockfile || yarn install; else yarn install; fi';
      }
      const script = `${installCmd} && ${startCmd}`;

      // Important: pass command and args as separate tokens so Docker
      // executes the intended binary (bash) with '-lc' and the script.
      dockerArgs.push(image, 'bash', '-lc', script);

      emitLifecycle('starting');

      const cmd = `docker ${dockerArgs.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`;
      log.info('[containers] docker run cmd', cmd);
      const { stdout } = await execAsync(cmd, { timeout: DOCKER_RUN_TIMEOUT_MS });
      const containerId = (stdout || '').trim();

      // Emit ports and ready lifecycle
      emitPorts(
        allocated.map((a) => ({ service: a.service, container: a.container, host: a.host })),
        previewService
      );
      this.emitRunnerEvent({
        ts: now(),
        workspaceId,
        runId,
        mode,
        type: 'lifecycle',
        status: 'starting',
        containerId,
      });
      emitLifecycle('ready');

      return {
        ok: true,
        runId,
        config,
        sourcePath: loadResult.sourcePath ?? null,
      };
    } catch (error) {
      log.error('[containers] docker run failed', error);
      const serialized = this.serializeStartError(error, {
        workspaceId,
        runId,
        mode,
        now,
      });
      if (serialized.event) this.emitRunnerEvent(serialized.event);
      return { ok: false, error: serialized.error };
    }
  }

  /** Stop and remove a running container for a workspace */
  async stopRun(workspaceId: string, opts: { now?: () => number; mode?: RunnerMode } = {}) {
    const now = opts.now ?? Date.now;
    const mode = opts.mode ?? 'container';
    const runId = this.generateRunId(now);
    const containerName = `emdash_ws_${workspaceId}`;
    try {
      this.emitRunnerEvent({
        ts: now(),
        workspaceId,
        runId,
        mode,
        type: 'lifecycle',
        status: 'stopping',
      });
      await promisify(exec)(`docker rm -f ${JSON.stringify(containerName)}`);
      this.emitRunnerEvent({
        ts: now(),
        workspaceId,
        runId,
        mode,
        type: 'lifecycle',
        status: 'stopped',
      });
      return { ok: true } as const;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.emitRunnerEvent({
        ts: now(),
        workspaceId,
        runId,
        mode,
        type: 'error',
        code: 'UNKNOWN',
        message,
      });
      return { ok: false, error: message } as const;
    }
  }

  async startMockRun(options: ContainerStartOptions): Promise<ContainerStartResult> {
    const { workspaceId, workspacePath } = options;
    if (!workspaceId || !workspacePath) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: '`workspaceId` and `workspacePath` are required',
          configKey: null,
          configPath: null,
        },
      };
    }

    const loadResult = await this.loadConfig(workspacePath);
    if (loadResult.ok === false) {
      return {
        ok: false,
        error: this.serializeConfigError(loadResult.error),
      };
    }

    const now = options.now ?? Date.now;
    const runId = options.runId ?? this.generateRunId(now);
    const mode = options.mode ?? 'container';

    try {
      const events = await generateMockStartEvents({
        workspaceId,
        config: loadResult.config,
        portAllocator: this.portAllocator,
        runId,
        mode,
        now,
      });

      for (const event of events) {
        this.emitRunnerEvent(event);
      }

      return {
        ok: true,
        runId,
        config: loadResult.config,
        sourcePath: loadResult.sourcePath ?? null,
      };
    } catch (error) {
      log.error('container runner start failed', error);
      const serialized = this.serializeStartError(error, {
        workspaceId,
        runId,
        mode,
        now,
      });
      if (serialized.event) {
        this.emitRunnerEvent(serialized.event);
      }
      return {
        ok: false,
        error: serialized.error,
      };
    }
  }

  private async loadConfig(workspacePath: string): Promise<ContainerConfigLoadResult> {
    return loadWorkspaceContainerConfig(workspacePath);
  }

  private serializeConfigError(error: ContainerConfigLoadError): ContainerStartError {
    return {
      code: error.code,
      message: error.message,
      configPath: error.configPath ?? null,
      configKey: error.configKey ?? null,
    };
  }

  private serializeStartError(
    cause: unknown,
    context: {
      workspaceId: string;
      runId: string;
      mode: RunnerMode;
      now: () => number;
    }
  ): { error: ContainerStartError; event?: RunnerErrorEvent } {
    if (cause instanceof PortAllocationError) {
      const event: RunnerErrorEvent = {
        ts: context.now(),
        workspaceId: context.workspaceId,
        runId: context.runId,
        mode: context.mode,
        type: 'error',
        code: cause.code,
        message: cause.message,
      };
      return {
        error: {
          code: cause.code,
          message: cause.message,
          configKey: null,
          configPath: null,
        },
        event,
      };
    }

    // Prefer stderr/stdout details when the error originates from child_process.exec
    let message = 'Failed to start container run';
    if (cause && typeof cause === 'object') {
      const anyErr = cause as any;
      if (typeof anyErr.stderr === 'string' && anyErr.stderr.trim().length > 0) {
        message = anyErr.stderr.trim();
      } else if (typeof anyErr.stdout === 'string' && anyErr.stdout.trim().length > 0) {
        message = anyErr.stdout.trim();
      } else if (anyErr instanceof Error && typeof anyErr.message === 'string') {
        message = anyErr.message;
      }
    }
    return {
      error: {
        code: 'UNKNOWN',
        message,
        configKey: null,
        configPath: null,
      },
      event: {
        ts: context.now(),
        workspaceId: context.workspaceId,
        runId: context.runId,
        mode: context.mode,
        type: 'error',
        code: 'UNKNOWN',
        message,
      },
    };
  }

  private generateRunId(now: () => number): string {
    return `r_${new Date(now()).toISOString()}`;
  }
}

export const containerRunnerService = new ContainerRunnerService();
