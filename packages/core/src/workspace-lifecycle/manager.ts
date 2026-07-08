import { err, ok, type Result } from '@emdash/shared';
import {
  createLiveModelHost,
  LiveLog,
  type LiveJobContext,
  type LiveModelHost,
} from '@emdash/wire';
import { workspaceLifecycleContract } from './api/contract';
import { planRejectionToBootstrapError, toBootstrapError } from './api/errors';
import type {
  BootstrapError,
  BootstrapProgress,
  BootstrapResult,
  LifecycleState,
  ObservedWorkspaceState,
  PhaseKind,
  RunPhaseInput,
  ScriptOutputKey,
  WorkspaceLifecycleKey,
  WorkspaceLifecyclePhase,
  WorkspaceRef,
} from './api/schemas';
import { validateBootstrapPlan } from './plan/validate';
import type { WorkspaceLifecycleHooks, WorkspaceLifecycleLogger } from './ports';
import { derivePhase, probeWorkspace } from './probe';
import { noRepoLock, repoLock, type RepoLock } from './runner/repo-lock';
import { runBootstrapPlan } from './runner/runner';

const SCRIPT_LOG_RETAIN_MS = 5 * 60 * 1000;

type ScriptLogEntry = {
  log: LiveLog;
  evictionTimer?: ReturnType<typeof setTimeout>;
};

export type WorkspaceLifecycleManagerDeps = {
  hooks?: WorkspaceLifecycleHooks;
  lock?: RepoLock;
  logger?: WorkspaceLifecycleLogger;
  scriptLogRetainMs?: number;
};

export class WorkspaceLifecycleManager {
  readonly host: LiveModelHost<typeof workspaceLifecycleContract.workspace>;
  private readonly inFlight = new Map<string, PhaseKind>();
  private readonly scriptLogs = new Map<string, ScriptLogEntry>();
  private readonly lock: RepoLock;
  private readonly scriptLogRetainMs: number;

  constructor(private readonly deps: WorkspaceLifecycleManagerDeps = {}) {
    this.host = createLiveModelHost(workspaceLifecycleContract.workspace);
    this.lock = deps.lock ?? repoLock;
    this.scriptLogRetainMs = deps.scriptLogRetainMs ?? SCRIPT_LOG_RETAIN_MS;
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

  scriptLog(key: ScriptOutputKey): LiveLog {
    return this.getScriptLog(key).log;
  }

  dispose(): void {
    this.host.dispose();
    for (const entry of this.scriptLogs.values()) {
      if (entry.evictionTimer) clearTimeout(entry.evictionTimer);
    }
    this.scriptLogs.clear();
  }

  private async runPhaseLocked(
    input: RunPhaseInput,
    ctx: LiveJobContext<BootstrapProgress>
  ): Promise<Result<BootstrapResult, BootstrapError>> {
    const before = await this.refreshOrThrow(input.ref, ctx.signal);
    if (this.inFlight.has(input.ref.workspaceId)) {
      return err({
        type: 'phase-in-flight',
        message: `Workspace "${input.ref.workspaceId}" already has an active lifecycle phase`,
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
        workspaceId: input.ref.workspaceId,
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

    this.inFlight.set(input.ref.workspaceId, input.phase);
    await this.publish(input.ref, undefined, ctx.jobId, ctx.signal);
    this.emitPhaseChanged(input.ref.workspaceId, this.inFlightPhase(input.phase), before.path);

    let result: Result<BootstrapResult, BootstrapError>;
    try {
      result = await runBootstrapPlan(plan.data, input.context, {
        lock: noRepoLock,
        signal: ctx.signal,
        onProgress: ctx.progress,
        onStepOutput: (stepId, chunk) =>
          this.getScriptLog({ jobId: ctx.jobId, stepId }).log.append(chunk),
      });
    } catch (error) {
      result = err(toBootstrapError(error));
    } finally {
      this.inFlight.delete(input.ref.workspaceId);
    }

    const lastError = result.success ? undefined : result.error;
    const after = await this.publish(input.ref, lastError, undefined, ctx.signal);
    this.emitPhaseChanged(input.ref.workspaceId, after.phase, after.path);
    this.scheduleScriptLogEviction(ctx.jobId);
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
    const cell = this.cellFor(ref);
    cell.states.lifecycle.produce((draft) => {
      Object.assign(draft, state);
    });
    return state;
  }

  private stateFromObserved(
    ref: WorkspaceRef,
    observed: ObservedWorkspaceState,
    lastError: BootstrapError | undefined,
    activeJobId: string | undefined
  ): LifecycleState {
    return {
      phase: derivePhase(observed, this.inFlight.get(ref.workspaceId)),
      setup: observed.setup,
      branchName: ref.branchName,
      branchCreatedByEmdash: observed.branchCreatedByEmdash,
      path: observed.worktree?.path,
      lastError,
      activeJobId,
    };
  }

  private cellFor(ref: WorkspaceRef) {
    const key = { workspaceId: ref.workspaceId } satisfies WorkspaceLifecycleKey;
    return (
      this.host.get(key) ??
      this.host.create(key, {
        lifecycle: {
          phase: 'unprovisioned',
          setup: 'not-applicable',
          branchName: ref.branchName,
        },
      })
    );
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
      { branchExists: true, branchCreatedByEmdash: false, setup: 'not-applicable' },
      phase
    );
  }

  private getScriptLog(key: ScriptOutputKey): ScriptLogEntry {
    const id = scriptLogId(key);
    const existing = this.scriptLogs.get(id);
    if (existing) {
      if (existing.evictionTimer) clearTimeout(existing.evictionTimer);
      existing.evictionTimer = undefined;
      return existing;
    }
    const entry = { log: new LiveLog() };
    this.scriptLogs.set(id, entry);
    return entry;
  }

  private scheduleScriptLogEviction(jobId: string): void {
    for (const [id, entry] of this.scriptLogs) {
      if (!id.startsWith(`${jobId}:`)) continue;
      if (entry.evictionTimer) clearTimeout(entry.evictionTimer);
      entry.evictionTimer = setTimeout(() => {
        if (this.scriptLogs.get(id) === entry) this.scriptLogs.delete(id);
      }, this.scriptLogRetainMs);
    }
  }

  private emitPhaseChanged(
    workspaceId: string,
    phase: WorkspaceLifecyclePhase,
    path: string | undefined
  ): void {
    try {
      this.deps.hooks?.onPhaseChanged?.({ workspaceId, phase, path });
    } catch (error) {
      this.deps.logger?.warn?.('Workspace lifecycle phase hook failed', error);
    }
  }
}

function scriptLogId(key: ScriptOutputKey): string {
  return `${key.jobId}:${key.stepId}`;
}
