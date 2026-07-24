import { err, ok, type Result } from '@emdash/shared';
import { LiveLog, type LiveJobContext } from '@emdash/wire';
import {
  planRejectionToBootstrapError,
  toBootstrapError,
} from '@runtimes/workspace/api/provisioning/errors';
import type {
  BootstrapError,
  BootstrapProgress,
  BootstrapResult,
  LifecycleState,
  ObservedWorkspaceState,
  PhaseKind,
  RunPhaseInput,
  StepOutputKey,
  WorkspaceListEntry,
  WorkspaceLifecyclePhase,
  WorkspaceRef,
} from '@runtimes/workspace/api/provisioning/schemas';
import { validateBootstrapPlan } from '@runtimes/workspace/node/provisioning/lifecycle/plan/validate';
import {
  noRepoLock,
  repoLock,
  type RepoLock,
} from '@runtimes/workspace/node/provisioning/lifecycle/runner/repo-lock';
import { runBootstrapPlan } from '@runtimes/workspace/node/provisioning/lifecycle/runner/runner';
import type { WorkspaceLifecycleHooks, WorkspaceLifecycleLogger } from './ports';
import { derivePhase, listRepoWorkspaces, probeWorkspace } from './probe';

const STEP_LOG_RETAIN_MS = 5 * 60 * 1000;

type StepLogEntry = {
  log: LiveLog;
  evictionTimer?: ReturnType<typeof setTimeout>;
};

export type WorkspaceLifecycleManagerDeps = {
  hooks?: WorkspaceLifecycleHooks;
  lock?: RepoLock;
  logger?: WorkspaceLifecycleLogger;
  stepLogRetainMs?: number;
};

export class WorkspaceLifecycleManager {
  private readonly inFlight = new Map<string, PhaseKind>();
  private readonly stepLogs = new Map<string, StepLogEntry>();
  private readonly lock: RepoLock;
  private readonly stepLogRetainMs: number;

  constructor(private readonly deps: WorkspaceLifecycleManagerDeps = {}) {
    this.lock = deps.lock ?? repoLock;
    this.stepLogRetainMs = deps.stepLogRetainMs ?? STEP_LOG_RETAIN_MS;
  }

  async refresh(
    ref: WorkspaceRef,
    signal?: AbortSignal
  ): Promise<Result<LifecycleState, BootstrapError>> {
    try {
      const state = await this.refreshOrThrow(ref, signal);
      return ok(state);
    } catch (error) {
      return err(toBootstrapError(error));
    }
  }

  async runPhase(
    input: RunPhaseInput,
    ctx: LiveJobContext<BootstrapProgress>
  ): Promise<Result<BootstrapResult, BootstrapError>> {
    return await this.lock.withLock(input.context.repoPath, () => this.runPhaseLocked(input, ctx));
  }

  async listWorkspaces(
    repoPath: string,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceListEntry[], BootstrapError>> {
    try {
      return ok(await listRepoWorkspaces(repoPath, { signal }));
    } catch (error) {
      return err(toBootstrapError(error));
    }
  }

  stepLog(key: StepOutputKey): LiveLog {
    return this.getStepLog(key).log;
  }

  dispose(): void {
    for (const entry of this.stepLogs.values()) {
      if (entry.evictionTimer) clearTimeout(entry.evictionTimer);
    }
    this.stepLogs.clear();
  }

  private async runPhaseLocked(
    input: RunPhaseInput,
    ctx: LiveJobContext<BootstrapProgress>
  ): Promise<Result<BootstrapResult, BootstrapError>> {
    const before = await this.refreshOrThrow(input.ref, ctx.signal);
    if (this.inFlight.has(input.ref.path)) {
      return err({
        type: 'phase-in-flight',
        message: `Workspace "${input.ref.path}" already has an active lifecycle phase`,
      });
    }

    const transitionError = this.validateTransition(before.phase, input.phase);
    if (transitionError) return err(transitionError);

    const plan = validateBootstrapPlan(input.plan);
    if (!plan.success) return err(planRejectionToBootstrapError(plan.error));

    if (
      input.phase === 'teardown' &&
      !input.force &&
      before.path &&
      this.deps.hooks?.beforeTeardown
    ) {
      const allowed = await this.deps.hooks.beforeTeardown({
        path: before.path,
        force: false,
        signal: ctx.signal,
      });
      if (!allowed.success) {
        return err({
          type: allowed.error.type,
          message: 'Workspace is in use',
          resolutions: ['force'],
        });
      }
    }

    this.inFlight.set(input.ref.path, input.phase);
    await this.publish(input.ref, undefined, ctx.jobId, ctx.signal);
    this.emitPhaseChanged(input.ref.path, this.inFlightPhase(input.phase));

    let result: Result<BootstrapResult, BootstrapError>;
    try {
      result = await runBootstrapPlan(plan.data, input.context, {
        lock: noRepoLock,
        signal: ctx.signal,
        onProgress: ctx.progress,
        onStepOutput: (stepId, chunk) =>
          this.getStepLog({ jobId: ctx.jobId, stepId }).log.append(chunk),
      });
    } catch (error) {
      result = err(toBootstrapError(error));
    } finally {
      this.inFlight.delete(input.ref.path);
    }

    const lastError = result.success ? undefined : result.error;
    const after = await this.publish(input.ref, lastError, undefined, ctx.signal);
    this.emitPhaseChanged(after.path, after.phase);
    this.scheduleStepLogEviction(ctx.jobId);
    return result;
  }

  private async refreshOrThrow(ref: WorkspaceRef, signal?: AbortSignal): Promise<LifecycleState> {
    return await this.publish(ref, undefined, undefined, signal);
  }

  private async publish(
    ref: WorkspaceRef,
    lastError: BootstrapError | undefined,
    activeJobId: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<LifecycleState> {
    const observed = await probeWorkspace(ref, { signal });
    const state = this.stateFromObserved(ref, observed, lastError, activeJobId);
    return state;
  }

  private stateFromObserved(
    ref: WorkspaceRef,
    observed: ObservedWorkspaceState,
    lastError: BootstrapError | undefined,
    activeJobId: string | undefined
  ): LifecycleState {
    return {
      phase: derivePhase(observed, this.inFlight.get(ref.path)),
      setup: observed.setup,
      git: observed.git,
      branchName: observed.branchName,
      branchCreatedByEmdash: observed.branchCreatedByEmdash,
      path: observed.path,
      lastError,
      activeJobId,
    };
  }

  private validateTransition(
    current: WorkspaceLifecyclePhase,
    phase: PhaseKind
  ): BootstrapError | undefined {
    if (current === 'provisioning' || current === 'setting-up' || current === 'tearing-down') {
      return {
        type: 'illegal-transition',
        message: `Cannot ${phase} while workspace is ${current}`,
      };
    }
    if (phase === 'provision' && current !== 'unprovisioned') {
      return {
        type: 'illegal-transition',
        message: `Cannot provision while workspace is ${current}`,
      };
    }
    if (phase === 'setup' && current !== 'provisioned' && current !== 'ready') {
      return {
        type: 'illegal-transition',
        message: `Cannot setup while workspace is ${current}`,
      };
    }
    if (phase === 'teardown' && current !== 'provisioned' && current !== 'ready') {
      return {
        type: 'illegal-transition',
        message: `Cannot teardown while workspace is ${current}`,
      };
    }
    return undefined;
  }

  private inFlightPhase(phase: PhaseKind): WorkspaceLifecyclePhase {
    return derivePhase(
      {
        git: 'none',
        path: '',
        directoryExists: true,
        branchCreatedByEmdash: false,
        setup: 'not-applicable',
      },
      phase
    );
  }

  private getStepLog(key: StepOutputKey): StepLogEntry {
    const id = stepLogId(key);
    const existing = this.stepLogs.get(id);
    if (existing) {
      if (existing.evictionTimer) clearTimeout(existing.evictionTimer);
      existing.evictionTimer = undefined;
      return existing;
    }
    const entry = { log: new LiveLog() };
    this.stepLogs.set(id, entry);
    return entry;
  }

  private scheduleStepLogEviction(jobId: string): void {
    for (const [id, entry] of this.stepLogs) {
      if (!id.startsWith(`${jobId}:`)) continue;
      if (entry.evictionTimer) clearTimeout(entry.evictionTimer);
      entry.evictionTimer = setTimeout(() => {
        if (this.stepLogs.get(id) === entry) this.stepLogs.delete(id);
      }, this.stepLogRetainMs);
    }
  }

  private emitPhaseChanged(path: string, phase: WorkspaceLifecyclePhase): void {
    try {
      this.deps.hooks?.onPhaseChanged?.({ path, phase });
    } catch (error) {
      this.deps.logger?.warn?.('Workspace lifecycle phase hook failed', error);
    }
  }
}

function stepLogId(key: StepOutputKey): string {
  return `${key.jobId}:${key.stepId}`;
}
