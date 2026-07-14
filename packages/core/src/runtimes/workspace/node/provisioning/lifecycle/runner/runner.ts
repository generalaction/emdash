import { err, ok, type Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { retrySchedules } from '@emdash/shared/scheduling';
import {
  createWorkflow,
  defineWorkflowNode,
  type WorkflowNodeDefinition,
  type WorkflowState,
} from '@primitives/workflow/api';
import { resolveFatal } from '@runtimes/workspace/api/provisioning/descriptor';
import type {
  BootstrapContext,
  BootstrapError,
  BootstrapPlan,
  BootstrapProgress,
  BootstrapResult,
  BootstrapStepReport,
  BootstrapStepView,
} from '@runtimes/workspace/api/provisioning/schemas';
import type { StepCtx } from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import {
  bootstrapStepRegistry,
  stepImplementationFor,
  type BootstrapStepRegistry,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/registry';
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
  let resolvedWorktreePath: string | undefined;
  const report: BootstrapStepReport[] = [];
  const entries = new Map(plan.steps.map((entry) => [entry.id, entry]));
  const scope = createScope({ label: 'bootstrap-plan' });

  const nodes: WorkflowNodeDefinition[] = plan.steps.map((entry, index) => {
    const implementation = stepImplementationFor(registry, entry.step);
    return defineWorkflowNode({
      id: entry.id,
      label: entry.label,
      dependsOn: index === 0 ? [] : [plan.steps[index - 1].id],
      retry: retrySchedules.sequence(retryDelaysMs),
      fatal: () => resolveFatal(implementation.descriptor, entry.step.args),
      async run(ctx) {
        const stepContext: StepCtx = {
          repoPath: context.repoPath,
          preservePatterns: context.preservePatterns,
        };
        if (resolvedWorktreePath) stepContext.resolvedWorktreePath = resolvedWorktreePath;
        if (ctx.signal) stepContext.signal = ctx.signal;
        stepContext.emitOutput = ctx.emit;
        stepContext.reportProgress = ctx.report;

        const result = await implementation.execute(entry.step.args, stepContext);
        if (result.success) {
          const facts = result.facts ?? {};
          if (facts.path) resolvedWorktreePath = facts.path;
          report.push({
            stepId: entry.id,
            kind: entry.step.kind,
            args: entry.step.args,
            facts,
          });
          return {
            status: 'done',
            facts,
            warnings: result.warnings,
          };
        }

        return {
          status: 'failed',
          failure: result.class,
          error: withStep(result.error, entry.id, entry.step.kind),
        };
      },
    });
  });

  const workflow = createWorkflow({
    nodes,
    scope,
    signal: options.signal,
    onOutput: ({ nodeId, chunk }) => options.onStepOutput?.(nodeId, chunk),
  });
  if (!workflow.success) {
    await scope.dispose();
    return err({
      type: workflow.error.type,
      message: workflow.error.message,
    });
  }

  const emitState = (state: WorkflowState): void => {
    if (
      Object.values(state.nodes).some(
        (node) => node.status === 'running' && node.attempt === undefined
      )
    ) {
      return;
    }
    emitProgress(workflowStateToStepViews(state, plan, entries), options);
  };

  emitState(workflow.data.machine.current());
  const unsubscribe = workflow.data.machine.subscribe((batch) => emitState(batch.state));
  const result = await workflow.data.run();
  unsubscribe();
  workflow.data.dispose();
  await scope.dispose();

  if (!result.success) {
    return err(result.error.type === 'cancelled' ? cancelledError() : result.error);
  }

  if (plan.steps.some((entry) => entry.step.kind === 'add-worktree') && !resolvedWorktreePath) {
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
    return err(error);
  }

  return ok({
    path: resolvedWorktreePath ?? '',
    warnings: result.data.warnings,
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

function workflowStateToStepViews(
  state: WorkflowState,
  plan: BootstrapPlan,
  entries: ReadonlyMap<string, BootstrapPlan['steps'][number]>
): BootstrapStepView[] {
  return plan.steps.map((entry) => {
    const node = state.nodes[entry.id];
    const planned = entries.get(entry.id) ?? entry;
    return {
      id: planned.id,
      kind: planned.step.kind,
      label: planned.label,
      status: node?.status ?? 'pending',
      attempt: node?.attempt,
      progress: node?.progress,
      warnings: node?.warnings,
      error: node?.error as BootstrapError | undefined,
    };
  });
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
