import type {
  DependencyCategory,
  DependencyId,
  DependencyInstallResult,
  DependencyState,
  DependencyStatus,
} from '@shared/dependencies';
import { dependencyStatusUpdatedChannel } from '@shared/events/appEvents';
import { err, ok } from '@shared/result';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { getLocalExec, getSshExec, type ExecFn } from '@main/core/utils/exec';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  createSshInstallCommandRunner,
  runLocalInstallCommand,
  type InstallCommandRunner,
} from './install-runner';
import { resolveCommandPath, runVersionProbe } from './probe';
import { DEPENDENCIES, getDependencyDescriptor } from './registry';
import type { DependencyDescriptor, ProbeResult } from './types';

const VERSION_RE = /(\d+\.\d+[\d.]*)/;

function resolveProbeStatus(
  descriptor: DependencyDescriptor,
  resolvedPath: string | null,
  probe: ProbeResult
): DependencyStatus {
  if (descriptor.resolveStatus) {
    return descriptor.resolveStatus(probe);
  }
  if (resolvedPath !== null) return 'available';
  if (probe.exitCode !== null && (probe.stdout || probe.stderr)) return 'available';
  if (probe.timedOut && probe.stdout) return 'available';
  return probe.exitCode === null ? 'missing' : 'error';
}

function extractVersion(probe: ProbeResult): string | null {
  const raw = (probe.stdout || probe.stderr).trim();
  const firstLine = raw.split('\n')[0]?.trim() ?? '';
  // Extract a version-like token, e.g. "git version 2.39.0" → "2.39.0"
  const m = VERSION_RE.exec(firstLine);
  return m ? m[1] : firstLine || null;
}

function dependencyStateFromProbeResult(
  descriptor: DependencyDescriptor,
  resolvedPath: string | null,
  probe: ProbeResult | null
): DependencyState {
  let status: DependencyStatus;
  let version: string | null = null;

  if (probe === null) {
    status = resolvedPath !== null ? 'available' : 'missing';
  } else {
    status = resolveProbeStatus(descriptor, resolvedPath, probe);
  }

  if (status === 'available' && probe) {
    version = extractVersion(probe);
  }

  return {
    id: descriptor.id,
    category: descriptor.category,
    status,
    version,
    path: resolvedPath,
    checkedAt: Date.now(),
    error: status === 'error' ? probe?.stderr?.trim() || 'Unknown error' : undefined,
  };
}

export class DependencyManager {
  private state = new Map<DependencyId, DependencyState>();
  private readonly exec: ExecFn;
  private readonly emitEvents: boolean;
  private readonly runInstallCommand: InstallCommandRunner;
  private readonly connectionId: string | undefined;

  constructor(
    exec: ExecFn,
    {
      emitEvents = true,
      runInstallCommand = runLocalInstallCommand,
      connectionId,
    }: {
      emitEvents?: boolean;
      runInstallCommand?: InstallCommandRunner;
      connectionId?: string;
    } = {}
  ) {
    this.exec = exec;
    this.emitEvents = emitEvents;
    this.runInstallCommand = runInstallCommand;
    this.connectionId = connectionId;
  }

  /**
   * Kick off background probing for all dependencies. Returns immediately;
   * results stream in via `dependencyStatusUpdatedChannel` events.
   */
  initialize(): void {
    void this.probeAll();
  }

  getAll(): Map<DependencyId, DependencyState> {
    return new Map(this.state);
  }

  get(id: DependencyId): DependencyState | undefined {
    return this.state.get(id);
  }

  getByCategory(cat: DependencyCategory): DependencyState[] {
    return [...this.state.values()].filter((s) => {
      const desc = getDependencyDescriptor(s.id);
      return desc?.category === cat;
    });
  }

  /**
   * Two-phase probe for a single dependency:
   *   1. Resolve path (fast, ~5ms) — emits an event immediately.
   *   2. Run version probe (slow, up to 10s) — emits a second event on completion.
   */
  async probe(id: DependencyId): Promise<DependencyState> {
    const descriptor = getDependencyDescriptor(id);
    if (!descriptor) {
      throw new Error(`Unknown dependency id: ${id}`);
    }

    // Phase 1: path resolution
    const resolvedPath = await this.resolveFirstPath(descriptor);
    const pathState = dependencyStateFromProbeResult(descriptor, resolvedPath, null);
    this.updateState(pathState);

    if (pathState.status === 'missing') {
      return pathState;
    }

    // Phase 2: version probe
    const versionArgs = descriptor.versionArgs ?? ['--version'];
    const probeResult = await runVersionProbe(
      descriptor.commands[0] ?? id,
      resolvedPath,
      versionArgs,
      this.exec
    );
    const fullState = dependencyStateFromProbeResult(descriptor, resolvedPath, probeResult);
    this.updateState(fullState);

    return fullState;
  }

  async probeAll(): Promise<void> {
    await Promise.all(
      DEPENDENCIES.map((d) =>
        this.probe(d.id).catch((err) => {
          log.warn(`[DependencyManager] Failed to probe ${d.id}:`, err);
        })
      )
    );
  }

  async probeCategory(cat: DependencyCategory): Promise<void> {
    const targets = DEPENDENCIES.filter((d) => d.category === cat);
    await Promise.all(
      targets.map((d) =>
        this.probe(d.id).catch((err) => {
          log.warn(`[DependencyManager] Failed to probe ${d.id}:`, err);
        })
      )
    );
  }

  /**
   * Run the installCommand for a dependency, then re-probe to update state.
   * Returns the updated DependencyState after installation attempt.
   */
  async install(id: DependencyId): Promise<DependencyInstallResult> {
    const descriptor = getDependencyDescriptor(id);
    if (!descriptor) {
      return err({ type: 'unknown-dependency', id });
    }
    if (!descriptor.installCommand) {
      return err({ type: 'no-install-command', id });
    }

    log.info(`[DependencyManager] Installing ${id}: ${descriptor.installCommand}`);

    const installResult = await this.runInstallCommand(descriptor.installCommand);
    if (!installResult.success) {
      return err(installResult.error);
    }

    const state = await this.probe(id);
    if (state.status !== 'available') {
      return err({ type: 'not-detected-after-install', id });
    }

    return ok(state);
  }

  private async resolveFirstPath(descriptor: DependencyDescriptor): Promise<string | null> {
    for (const command of descriptor.commands) {
      const path = await resolveCommandPath(command, this.exec);
      if (path) return path;
    }
    return null;
  }

  private updateState(state: DependencyState): void {
    this.state.set(state.id, state);
    if (this.emitEvents) {
      events.emit(dependencyStatusUpdatedChannel, {
        id: state.id,
        state,
        connectionId: this.connectionId,
      });
    }
  }
}

export const localDependencyManager = new DependencyManager(getLocalExec());

const sshManagers = new Map<string, DependencyManager>();

export async function getDependencyManager(connectionId?: string): Promise<DependencyManager> {
  if (!connectionId) return localDependencyManager;
  let mgr = sshManagers.get(connectionId);
  if (!mgr) {
    const proxy = await sshConnectionManager.connect(connectionId);
    mgr = new DependencyManager(getSshExec(proxy), {
      emitEvents: true,
      runInstallCommand: createSshInstallCommandRunner(proxy),
      connectionId,
    });
    sshManagers.set(connectionId, mgr);
  }
  return mgr;
}
