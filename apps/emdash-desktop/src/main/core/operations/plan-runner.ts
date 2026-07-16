import {
  createWorkflow,
  defineWorkflowNode,
  type WorkflowState,
} from '@emdash/core/primitives/workflow/api';
import { err, ok, type Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import {
  retrySchedules,
  runWithTimeout,
  TimeoutError,
  type Clock,
} from '@emdash/shared/scheduling';
import type { LifecycleOperationRow } from '@main/db/schema';
import type { OperationPlan, OperationProgress, OperationStepKind } from './operation-plan';
import { operationStepRegistry, type OperationStepRegistry } from './steps/operation-step-registry';

export type OperationPlanError = {
  type: string;
  message: string;
};

export type OperationPlanRunnerOptions = {
  registry?: OperationStepRegistry;
  signal?: AbortSignal;
  clock?: Clock;
  onProgress?: (progress: OperationProgress) => void;
};

const RETRY_DELAYS_MS = [1_000, 4_000];
const STEP_TIMEOUT_MS: Record<OperationStepKind, number> = {
  'kill-acp-sessions': 30_000,
  'kill-tui-sessions': 30_000,
  'deactivate-workspace': 5 * 60_000,
  'teardown-workspace': 5 * 60_000,
  'purge-task-rows': 30_000,
  'purge-workspace-row': 30_000,
  'purge-project-row': 30_000,
};

export async function runOperationPlan(
  operation: LifecycleOperationRow,
  plan: OperationPlan,
  options: OperationPlanRunnerOptions = {}
): Promise<Result<void, OperationPlanError>> {
  const registry = options.registry ?? operationStepRegistry;
  const scope = createScope({ label: `operation:${operation.id}`, clock: options.clock });
  const nodes = plan.steps.map((step, index) =>
    defineWorkflowNode({
      id: step.id,
      label: step.label,
      dependsOn: index === 0 ? [] : [plan.steps[index - 1].id],
      retry: retrySchedules.sequence(RETRY_DELAYS_MS),
      fatal: true,
      async run(ctx) {
        try {
          await runWithTimeout((signal) => registry.execute(step.kind, operation, signal), {
            timeoutMs: STEP_TIMEOUT_MS[step.kind],
            signal: ctx.signal,
            clock: options.clock,
          });
          return { status: 'done' as const };
        } catch (error) {
          const timedOut = error instanceof TimeoutError;
          return {
            status: 'failed' as const,
            failure: timedOut ? ('permanent' as const) : ('transient' as const),
            error: {
              type: timedOut ? 'operation-step-timeout' : 'operation-step-failed',
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
    })
  );
  const workflow = createWorkflow({
    nodes,
    scope,
    signal: options.signal,
    clock: options.clock,
  });
  if (!workflow.success) {
    await scope.dispose();
    return err(workflow.error);
  }

  const emitProgress = (state: WorkflowState): void => {
    const nodeStates = Object.values(state.nodes);
    const current = nodeStates.find((node) => node.status === 'running');
    options.onProgress?.({
      currentStep: current?.id,
      completedSteps: nodeStates.filter(
        (node) => node.status === 'done' || node.status === 'skipped'
      ).length,
      totalSteps: nodeStates.length,
    });
  };

  emitProgress(workflow.data.machine.current());
  const unsubscribe = workflow.data.machine.subscribe((batch) => emitProgress(batch.state));
  const result = await workflow.data.run();
  unsubscribe();
  workflow.data.dispose();
  await scope.dispose();

  return result.success ? ok() : err(result.error);
}
