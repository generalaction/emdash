import { err, ok, type Result } from '@emdash/shared';
import type {
  BootstrapContext,
  BootstrapError,
  BootstrapPlan,
  BootstrapProgress,
  BootstrapResult,
  BootstrapStepReport,
  BootstrapStepView,
  BootstrapStepWarning,
} from '../api/schemas';
import { planToStepViews } from '../plan/steps';
import { resolveFatal } from '../steps/descriptor';
import type { StepCtx } from '../steps/implement';
import {
  bootstrapStepRegistry,
  stepImplementationFor,
  type BootstrapStepRegistry,
} from '../steps/registry';
import { repoLock, type RepoLock } from './repo-lock';

export type BootstrapRunnerOptions = {
  registry?: BootstrapStepRegistry;
  lock?: Pick<RepoLock, 'withLock'>;
  retryDelaysMs?: number[];
  signal?: AbortSignal;
  onProgress?: (progress: BootstrapProgress) => void;
  onStepOutput?: (stepId: string, chunk: string) => void;
};

const DEFAULT_RETRY_DELAYS_MS = [1_000, 4_000];

export async function runBootstrapPlan(
  plan: BootstrapPlan,
  context: BootstrapContext,
  options: BootstrapRunnerOptions = {}
): Promise<Result<BootstrapResult, BootstrapError>> {
  const lock = options.lock ?? repoLock;
  return lock.withLock(context.repoPath, () => runBootstrapPlanLocked(plan, context, options));
}

async function runBootstrapPlanLocked(
  plan: BootstrapPlan,
  context: BootstrapContext,
  options: BootstrapRunnerOptions
): Promise<Result<BootstrapResult, BootstrapError>> {
  const registry = options.registry ?? bootstrapStepRegistry;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const runContext: StepCtx = { ...context, signal: options.signal };
  const views = planToStepViews(plan);
  const warnings: BootstrapStepWarning[] = [];
  const report: BootstrapStepReport[] = [];

  emitProgress(views, options);

  for (let index = 0; index < plan.steps.length; index++) {
    if (options.signal?.aborted) {
      markSkippedFrom(views, index);
      emitProgress(views, options);
      return err(cancelledError());
    }

    const entry = plan.steps[index];
    const view = views[index];
    const implementation = stepImplementationFor(registry, entry.step);
    let attempt = 0;

    while (true) {
      if (options.signal?.aborted) {
        view.status = 'skipped';
        markSkippedFrom(views, index + 1);
        emitProgress(views, options);
        return err(cancelledError());
      }

      attempt++;
      view.status = 'running';
      view.attempt = attempt;
      emitProgress(views, options);

      let result: Awaited<ReturnType<typeof implementation.execute>>;
      try {
        runContext.emitOutput = (chunk) => options.onStepOutput?.(entry.id, chunk);
        runContext.reportProgress = (progress) => {
          view.progress = progress;
          emitProgress(views, options);
        };
        result = await implementation.execute(entry.step.args, runContext);
      } finally {
        runContext.emitOutput = undefined;
        runContext.reportProgress = undefined;
      }
      if (result.success) {
        const facts = result.facts ?? {};
        if (facts.path) runContext.resolvedWorktreePath = facts.path;

        if (result.warnings?.length) {
          view.warnings = result.warnings;
          warnings.push(...result.warnings);
        }

        report.push({
          stepId: entry.id,
          kind: entry.step.kind,
          args: entry.step.args,
          facts,
        });
        view.status = 'done';
        view.progress = undefined;
        emitProgress(views, options);
        break;
      }

      const retryDelayMs = retryDelaysMs[attempt - 1];
      if (result.class === 'transient' && retryDelayMs !== undefined && !options.signal?.aborted) {
        await delay(retryDelayMs, options.signal);
        continue;
      }

      const error = withStep(result.error, entry.id, entry.step.kind);
      if (!resolveFatal(implementation.descriptor, entry.step.args)) {
        view.warnings = [...(view.warnings ?? []), { type: error.type, message: error.message }];
        warnings.push({ type: error.type, message: error.message });
        view.status = 'done';
        view.progress = undefined;
        emitProgress(views, options);
        break;
      }

      view.status = 'failed';
      view.progress = undefined;
      view.error = error;
      markSkippedFrom(views, index + 1);
      emitProgress(views, options);
      return err(error);
    }
  }

  if (
    plan.steps.some((entry) => entry.step.kind === 'add-worktree') &&
    !runContext.resolvedWorktreePath
  ) {
    const entryIndex = plan.steps.findIndex((entry) => entry.step.kind === 'add-worktree');
    const entry = plan.steps[entryIndex];
    const error = withStep(
      {
        type: 'worktree-failed',
        message: 'No worktree path was resolved after executing all setup steps',
      },
      entry.id,
      entry.step.kind
    );
    views[entryIndex].status = 'failed';
    views[entryIndex].error = error;
    emitProgress(views, options);
    return err(error);
  }

  return ok({
    path: runContext.resolvedWorktreePath ?? '',
    warnings,
    report,
  });
}

function emitProgress(views: BootstrapStepView[], options: BootstrapRunnerOptions): void {
  options.onProgress?.({
    steps: views.map((view) => ({
      ...view,
      attempt: view.attempt,
      progress: view.progress ? { ...view.progress } : undefined,
      warnings: view.warnings ? [...view.warnings] : undefined,
      error: view.error ? { ...view.error } : undefined,
    })),
  });
}

function markSkippedFrom(views: BootstrapStepView[], startIndex: number): void {
  for (let index = startIndex; index < views.length; index++) {
    if (views[index].status === 'pending') views[index].status = 'skipped';
  }
}

function withStep(error: BootstrapError, stepId: string, stepKind: string): BootstrapError {
  return {
    ...error,
    stepId: error.stepId ?? stepId,
    stepKind: error.stepKind ?? stepKind,
  };
}

function cancelledError(): BootstrapError {
  return {
    type: 'cancelled',
    message: 'Workspace bootstrap was cancelled',
  };
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
