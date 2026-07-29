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
  RunPhaseInput,
  StepOutputKey,
  WorkspaceListEntry,
} from '@runtimes/workspace/api/provisioning/schemas';
import { validateBootstrapPlan } from '@runtimes/workspace/node/provisioning/lifecycle/plan/validate';
import {
  noRepoLock,
  repoLock,
  type RepoLock,
} from '@runtimes/workspace/node/provisioning/lifecycle/runner/repo-lock';
import { runBootstrapPlan } from '@runtimes/workspace/node/provisioning/lifecycle/runner/runner';
import { listRepoWorkspaces } from './probe';

const STEP_LOG_RETAIN_MS = 5 * 60 * 1000;

type StepLogEntry = {
  log: LiveLog;
  evictionTimer?: ReturnType<typeof setTimeout>;
};

export type WorkspaceLifecycleManagerDeps = {
  lock?: RepoLock;
  stepLogRetainMs?: number;
};

export class WorkspaceLifecycleManager {
  private readonly stepLogs = new Map<string, StepLogEntry>();
  private readonly lock: RepoLock;
  private readonly stepLogRetainMs: number;

  constructor(private readonly deps: WorkspaceLifecycleManagerDeps = {}) {
    this.lock = deps.lock ?? repoLock;
    this.stepLogRetainMs = deps.stepLogRetainMs ?? STEP_LOG_RETAIN_MS;
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
    const plan = validateBootstrapPlan(input.plan);
    if (!plan.success) return err(planRejectionToBootstrapError(plan.error));

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
    }

    this.scheduleStepLogEviction(ctx.jobId);
    return result;
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
}

function stepLogId(key: StepOutputKey): string {
  return `${key.jobId}:${key.stepId}`;
}
