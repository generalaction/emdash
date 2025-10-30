import { EventEmitter } from 'node:events';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

import type {
  ResolvedContainerConfig,
  PackageManager,
  ResolvedContainerPortConfig,
} from '@shared/container';
import {
  generateMockStartEvents,
  PortAllocationError,
  PortManager,
  type RunnerEvent,
  type RunnerErrorEvent,
  type RunnerMode,
} from '@shared/container';

const execAsync = promisify(exec);

const LIVE_RELOAD_IGNORED_DIRS = new Set([
  '.git',
  '.emdash',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

const COMPOSE_LIVE_RELOAD_DEBOUNCE_MS = 700;

interface ComposeLiveReloadHandle {
  dispose(): Promise<void> | void;
}

interface ComposeLiveReloadOptions {
  workspaceId: string;
  workspacePath: string;
  composeArgsBase: string[];
  previewService?: string;
  runId: string;
  mode: RunnerMode;
  now: () => number;
}

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
  private readonly composeLiveReloads = new Map<string, ComposeLiveReloadHandle>();

  constructor(options: ContainerRunnerServiceOptions = {}) {
    super();
    this.portAllocator = options.portAllocator ?? new PortManager();
  }

  onRunnerEvent(listener: (event: RunnerEvent) => void): this {
    this.on(RUN_EVENT_CHANNEL, listener);
    return this;
  }

  private findComposeFile(workspacePath: string): string | null {
    const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    for (const rel of candidates) {
      const abs = path.join(workspacePath, rel);
      if (fs.existsSync(abs)) return abs;
    }
    return null;
  }

  private async startComposeRun(args: {
    workspaceId: string;
    workspacePath: string;
    runId: string;
    mode: RunnerMode;
    config: ResolvedContainerConfig;
    now: () => number;
    composeFile: string;
  }): Promise<ContainerStartResult> {
    const { workspaceId, workspacePath, runId, mode, config, now, composeFile } = args;
    const project = `emdash_ws_${workspaceId}`;

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
      // Ensure docker compose available
      try {
        await execAsync('docker compose version');
      } catch {
        const message = 'Docker Compose is not available. Please install/update Docker Desktop.';
        this.emitRunnerEvent({
          ts: now(),
          workspaceId,
          runId,
          mode,
          type: 'error',
          code: 'UNKNOWN',
          message,
        });
        return {
          ok: false,
          error: { code: 'UNKNOWN', message, configKey: null, configPath: null },
        };
      }

      // Always attempt autodiscovery first to avoid introducing unknown services (e.g. default 'app')
      const discovered = await this.discoverComposePorts(composeFile, workspacePath);
      let portRequests: ResolvedContainerPortConfig[] = [];
      if (discovered.length > 0) {
        portRequests = discovered.map((d) => ({
          service: d.service,
          container: d.container,
          protocol: 'tcp' as const,
          preview: false,
        }));
      } else {
        // Fallback to config when discovery is unavailable
        if (Array.isArray(config.ports) && config.ports.length) {
          portRequests = config.ports.map((p) => ({
            service: p.service,
            container: p.container,
            protocol: 'tcp' as const,
            preview: !!p.preview,
          }));
        }
      }

      const allocated = await this.portAllocator.allocate(portRequests);

      // Determine preview service: config wins; else heuristic
      let previewService = portRequests.find((p) => p.preview)?.service;
      if (!previewService) {
        previewService = this.choosePreviewService(portRequests);
      }

      // Build a sanitized compose file that removes host bindings (ports) and replaces with expose
      const sanitizedAbs = path.join(workspacePath, '.emdash', 'compose.sanitized.json');
      try {
        fs.mkdirSync(path.dirname(sanitizedAbs), { recursive: true });
      } catch {}
      try {
        const cfgJson = await this.loadComposeConfigJson(composeFile, workspacePath);
        const portMap = new Map<string, number[]>();
        for (const req of portRequests) {
          const arr = portMap.get(req.service) ?? [];
          if (!arr.includes(req.container)) arr.push(req.container);
          portMap.set(req.service, arr);
        }
        const sanitized = this.sanitizeComposeConfig(cfgJson, portMap);
        fs.writeFileSync(sanitizedAbs, JSON.stringify(sanitized, null, 2), 'utf8');
      } catch (e) {
        log.warn('[containers] failed to sanitize compose file; proceeding with original', e);
      }

      // Write override file mapping container ports -> random host ports
      const overrideAbs = path.join(workspacePath, '.emdash', 'compose.override.yml');
      try {
        fs.mkdirSync(path.dirname(overrideAbs), { recursive: true });
      } catch {}
      fs.writeFileSync(overrideAbs, this.buildComposeOverrideYaml(allocated), 'utf8');

      // Run compose up -d
      const composeArgsBase: string[] = ['compose'];
      const envFileAbs = config.envFile ? path.resolve(workspacePath, config.envFile) : null;
      if (envFileAbs && fs.existsSync(envFileAbs)) composeArgsBase.push('--env-file', envFileAbs);
      // Prefer sanitized file when available
      const composePathForUp = fs.existsSync(sanitizedAbs) ? sanitizedAbs : composeFile;
      composeArgsBase.push('-p', project, '-f', composePathForUp, '-f', overrideAbs);
      const upArgs = [...composeArgsBase, 'up', '-d'];
      emitLifecycle('starting');
      const cmd = this.buildDockerCommand(upArgs);
      log.info('[containers] compose up cmd', cmd);
      await execAsync(cmd);

      // Discover actual published ports
      let published: Array<{ service: string; container: number; host: number }> = [];
      try {
        const { stdout } = await execAsync(
          `docker compose -p ${JSON.stringify(project)} ps --format json`
        );
        published = this.parseComposePs(stdout, allocated);
      } catch {
        published = allocated.map((a) => ({
          service: a.service,
          container: a.container,
          host: a.host,
        }));
      }
      emitPorts(published, previewService);
      emitLifecycle('ready');
      try {
        await this.setupComposeLiveReload({
          workspaceId,
          workspacePath,
          composeArgsBase,
          previewService,
          runId,
          mode,
          now,
        });
      } catch (watchErr) {
        log.warn('[containers] failed to enable compose live reload', watchErr);
      }
      return { ok: true, runId, config, sourcePath: null };
    } catch (error) {
      log.error('[containers] compose run failed', error);
      const serialized = this.serializeStartError(error, { workspaceId, runId, mode, now });
      if (serialized.event) this.emitRunnerEvent(serialized.event);
      return { ok: false, error: serialized.error };
    }
  }

  private buildDockerCommand(args: string[]): string {
    return `docker ${args
      .map((a) => (/[\s]/.test(a) ? JSON.stringify(a) : a))
      .join(' ')}`;
  }

  private buildComposeOverrideYaml(
    mappings: Array<{ service: string; container: number; host: number }>
  ): string {
    const byService = new Map<string, Array<{ container: number; host: number }>>();
    for (const m of mappings) {
      const arr = byService.get(m.service) ?? [];
      arr.push({ container: m.container, host: m.host });
      byService.set(m.service, arr);
    }
    const lines: string[] = [];
    // Omit top-level 'version' to avoid deprecation warning; Compose v2 ignores it.
    lines.push('services:');
    for (const [svc, ports] of byService.entries()) {
      lines.push(`  ${svc}:`);
      lines.push('    ports:');
      for (const p of ports) {
        lines.push('      -');
        lines.push(`        target: ${p.container}`);
        lines.push(`        published: ${p.host}`);
        lines.push('        protocol: tcp');
      }
    }
    return lines.join('\n') + '\n';
  }

  private parseComposePs(
    out: string,
    allocated: Array<{ service: string; container: number; host: number }>
  ): Array<{ service: string; container: number; host: number }> {
    const trimmed = (out || '').trim();
    if (!trimmed) return allocated;
    let records: any[] = [];
    try {
      const parsed = JSON.parse(trimmed);
      records = Array.isArray(parsed) ? parsed : [];
    } catch {
      records = trimmed
        .split('\n')
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as any[];
    }
    const result: Array<{ service: string; container: number; host: number }> = [];
    for (const rec of records) {
      const svc = rec?.Service || rec?.service || rec?.Name || rec?.name;
      const ports = rec?.Publishers || rec?.Ports || [];
      if (!svc || !Array.isArray(ports)) continue;
      for (const port of ports) {
        const target = port?.TargetPort ?? port?.target ?? port?.Target ?? port?.ContainerPort;
        const published = port?.PublishedPort ?? port?.published ?? port?.HostPort;
        if (typeof target === 'number' && typeof published === 'number') {
          result.push({ service: String(svc), container: target, host: published });
        }
      }
    }
    return result.length ? result : allocated;
  }

  private async loadComposeConfigJson(composeFile: string, workspacePath: string): Promise<any> {
    const { stdout } = await execAsync(
      `docker compose -f ${JSON.stringify(composeFile)} config --format json`,
      { cwd: workspacePath }
    );
    try {
      return JSON.parse(stdout || '{}');
    } catch {
      return {};
    }
  }

  private sanitizeComposeConfig(cfg: any, requested: Map<string, number[]>): any {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const services = cfg.services || cfg.Services || {};
    const nextServices: Record<string, any> = {};
    for (const key of Object.keys(services)) {
      const svc = { ...(services as any)[key] };
      // Merge existing expose (numbers or strings) with requested containers
      const currentExpose: number[] = [];
      const exposeArr = Array.isArray(svc.expose) ? svc.expose : [];
      for (const ex of exposeArr) {
        const n = typeof ex === 'string' ? parseInt(ex, 10) : Number(ex);
        if (Number.isFinite(n)) currentExpose.push(n);
      }
      const req = requested.get(key) ?? [];
      for (const p of req) if (!currentExpose.includes(p)) currentExpose.push(p);
      // Remove host-published ports entirely to avoid conflicts
      if (svc.ports) delete svc.ports;
      if (currentExpose.length > 0) {
        svc.expose = currentExpose;
      }
      nextServices[key] = svc;
    }
    return { ...cfg, services: nextServices };
  }

  private async discoverComposePorts(
    composeFile: string,
    workspacePath: string
  ): Promise<Array<{ service: string; container: number }>> {
    try {
      const { stdout } = await execAsync(
        `docker compose -f ${JSON.stringify(composeFile)} config --format json`,
        { cwd: workspacePath }
      );
      const cfg = JSON.parse(stdout || '{}');
      const services = cfg?.services || cfg?.Services || {};
      const result: Array<{ service: string; container: number }> = [];
      for (const key of Object.keys(services)) {
        const svc = services[key];
        const ports = svc?.ports || svc?.Ports || [];
        if (!Array.isArray(ports)) continue;
        for (const p of ports) {
          // long form object
          if (p && typeof p === 'object') {
            const target =
              p.target ?? p.TargetPort ?? p.ContainerPort ?? p.Target ?? p.containerPort;
            const protocol = (p.protocol ?? 'tcp').toString().toLowerCase();
            if (typeof target === 'number' && protocol === 'tcp') {
              result.push({ service: key, container: target });
            }
            continue;
          }
          // short form string like "HOST:CONTAINER" or just "CONTAINER"
          if (typeof p === 'string') {
            const m = p.match(/^(?:\d+:)?(\d+)(?:\/tcp|\/udp)?$/i);
            if (m) {
              const portNum = parseInt(m[1], 10);
              if (Number.isFinite(portNum)) result.push({ service: key, container: portNum });
            }
          }
        }
      }
      // Deduplicate by (service, container)
      const seen = new Set<string>();
      return result.filter((r) => {
        const k = `${r.service}:${r.container}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } catch {
      return [];
    }
  }

  private choosePreviewService(requests: ResolvedContainerPortConfig[]): string {
    // Prefer common web service names
    const byName = (names: string[]) => requests.find((r) => names.includes(r.service))?.service;
    const name = byName(['web', 'app', 'frontend', 'ui']);
    if (name) return name;
    // Prefer common web ports
    const byPort = requests.find((r) => [3000, 5173, 8080, 8000].includes(r.container))?.service;
    if (byPort) return byPort;
    // Fallback to first
    return requests[0]?.service ?? 'app';
  }

  offRunnerEvent(listener: (event: RunnerEvent) => void): this {
    this.off(RUN_EVENT_CHANNEL, listener);
    return this;
  }

  emitRunnerEvent(event: RunnerEvent): boolean {
    return this.emit(RUN_EVENT_CHANNEL, event);
  }

  async inspectRun(workspaceId: string): Promise<
    | {
        ok: true;
        running: boolean;
        ports: Array<{ service: string; container: number; host: number }>;
        previewService?: string;
      }
    | { ok: false; error: string }
  > {
    const project = `emdash_ws_${workspaceId}`;
    try {
      const { stdout } = await execAsync(
        `docker compose -p ${JSON.stringify(project)} ps --format json`
      );
      // Parse published ports and running state
      let records: any[] = [];
      try {
        const parsed = JSON.parse((stdout || '').trim());
        records = Array.isArray(parsed) ? parsed : [];
      } catch {
        records = (stdout || '')
          .trim()
          .split('\n')
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean) as any[];
      }
      const running = records.some((r) => {
        const st = r?.State || r?.state || r?.Status;
        return typeof st === 'string' && st.toLowerCase().includes('running');
      });
      const ports = this.parseComposePs(stdout, []);
      const previewService = this.choosePreviewServiceFromPublished(ports);
      return { ok: true, running, ports, previewService };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  private choosePreviewServiceFromPublished(
    ports: Array<{ service: string; container: number; host: number }>
  ): string | undefined {
    if (!Array.isArray(ports) || ports.length === 0) return undefined;
    const byName = (names: string[]) => ports.find((p) => names.includes(p.service))?.service;
    const name = byName(['web', 'app', 'frontend', 'ui']);
    if (name) return name;
    const byPort = ports.find((p) => [3000, 5173, 8080, 8000].includes(p.container))?.service;
    if (byPort) return byPort;
    return ports[0]?.service;
  }

  private async setupComposeLiveReload(options: ComposeLiveReloadOptions): Promise<void> {
    await this.teardownComposeLiveReload(options.workspaceId);
    const handle = await this.createComposeLiveReloadHandle(options);
    if (handle) {
      this.composeLiveReloads.set(options.workspaceId, handle);
    }
  }

  private async createComposeLiveReloadHandle(
    options: ComposeLiveReloadOptions
  ): Promise<ComposeLiveReloadHandle | null> {
    let chokidarModule: any;
    try {
      chokidarModule = await import('chokidar');
    } catch (error) {
      log.warn('[containers] chokidar not available; compose live reload disabled', error);
      return null;
    }

    type MinimalWatcher = {
      on: (event: string, handler: (...args: any[]) => void) => MinimalWatcher;
      close: () => Promise<void>;
    };

    const chokidar = (chokidarModule?.default ?? chokidarModule) as {
      watch: (paths: string | string[], options?: Record<string, unknown>) => MinimalWatcher;
    };

    const watcher = chokidar.watch(options.workspacePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 100,
      },
      ignored: (watchedPath: string) =>
        this.shouldIgnoreLiveReloadChange(watchedPath, options.workspacePath),
    });

    const relevantEvents = new Set(['add', 'change', 'unlink', 'addDir', 'unlinkDir']);
    let disposed = false;
    let debounceTimer: NodeJS.Timeout | null = null;
    let rebuildRunning = false;
    let rebuildRequested = false;

    const scheduleRebuild = (reason: string) => {
      if (disposed) return;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runRebuild(reason);
      }, COMPOSE_LIVE_RELOAD_DEBOUNCE_MS);
    };

    const runRebuild = async (reason: string) => {
      if (disposed) return;
      if (rebuildRunning) {
        rebuildRequested = true;
        return;
      }
      rebuildRunning = true;

      const emitLifecycle = (status: 'building' | 'ready' | 'failed') => {
        const ts = options.now();
        this.emitRunnerEvent({
          ts,
          workspaceId: options.workspaceId,
          runId: options.runId,
          mode: options.mode,
          type: 'lifecycle',
          status,
        });
      };

      emitLifecycle('building');
      const args = [...options.composeArgsBase, 'up', '-d', '--build', '--force-recreate'];
      if (options.previewService) {
        args.push('--no-deps', options.previewService);
      }

      const cmd = this.buildDockerCommand(args);
      log.info('[containers] compose live reload', {
        workspaceId: options.workspaceId,
        reason,
        cmd,
      });

      try {
        await execAsync(cmd, { cwd: options.workspacePath });
        emitLifecycle('ready');
      } catch (error) {
        const message =
          typeof (error as any)?.stderr === 'string' && (error as any).stderr.trim().length > 0
            ? (error as any).stderr.trim()
            : error instanceof Error
              ? error.message
              : String(error);
        log.error('[containers] compose live reload failed', error);
        this.emitRunnerEvent({
          ts: options.now(),
          workspaceId: options.workspaceId,
          runId: options.runId,
          mode: options.mode,
          type: 'error',
          code: 'UNKNOWN',
          message,
        });
        emitLifecycle('ready');
      } finally {
        rebuildRunning = false;
        if (rebuildRequested && !disposed) {
          rebuildRequested = false;
          scheduleRebuild('rerun');
        }
      }
    };

    watcher.on('all', (eventName: string, eventPath: string) => {
      if (!relevantEvents.has(eventName)) return;
      if (disposed) return;
      const absolutePath = path.isAbsolute(eventPath)
        ? eventPath
        : path.join(options.workspacePath, eventPath);
      if (this.shouldIgnoreLiveReloadChange(absolutePath, options.workspacePath)) return;
      scheduleRebuild(eventName);
    });

    watcher.on('error', (error: unknown) => {
      log.warn('[containers] compose live reload watcher error', error);
    });

    return {
      dispose: async () => {
        disposed = true;
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        try {
          await watcher.close();
        } catch (error) {
          log.warn('[containers] failed to close compose live reload watcher', error);
        }
      },
    };
  }

  private shouldIgnoreLiveReloadChange(filePath: string, workspacePath: string): boolean {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspacePath, filePath);
    const rel = path.relative(workspacePath, absolutePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return true;
    }
    const segments = rel.split(path.sep).filter(Boolean);
    return segments.some((segment) => LIVE_RELOAD_IGNORED_DIRS.has(segment));
  }

  private async teardownComposeLiveReload(workspaceId: string): Promise<void> {
    const handle = this.composeLiveReloads.get(workspaceId);
    if (!handle) return;
    this.composeLiveReloads.delete(workspaceId);
    try {
      await handle.dispose();
    } catch (error) {
      log.warn('[containers] failed to dispose compose live reload watcher', error);
    }
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

    await this.teardownComposeLiveReload(workspaceId);

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

      // Prefer compose runner when a compose file exists at the workspace root
      const composeBase = this.findComposeFile(absWorkspace);
      if (composeBase) {
        log.info('[containers] compose detected; delegating to compose runner');
        return await this.startComposeRun({
          workspaceId,
          workspacePath: absWorkspace,
          runId,
          mode,
          config,
          now,
          composeFile: composeBase,
        });
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

      const cmd = this.buildDockerCommand(dockerArgs);
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
      await this.teardownComposeLiveReload(workspaceId);
      this.emitRunnerEvent({
        ts: now(),
        workspaceId,
        runId,
        mode,
        type: 'lifecycle',
        status: 'stopping',
      });
      // Try compose down first (ignore errors)
      try {
        await execAsync(this.buildDockerCommand(['compose', '-p', containerName, 'down', '-v']));
      } catch {}
      // Then single-container cleanup (if any)
      try {
        await execAsync(this.buildDockerCommand(['rm', '-f', containerName]));
      } catch {}
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
