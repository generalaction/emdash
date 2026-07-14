import type { Result } from '@emdash/shared';
import type { Machine } from '@emdash/shared/concurrency';
import type { Scope } from '@emdash/shared/concurrency';
import type { Clock, RetrySchedule } from '@emdash/shared/scheduling';

export type WorkflowFailureClass = 'transient' | 'conflict' | 'permanent';

export type WorkflowProgress = {
  percent?: number;
  message?: string;
};

export type WorkflowWarning = {
  type: string;
  message: string;
};

export type WorkflowError = {
  type: string;
  message: string;
  resolutions?: string[];
};

export type WorkflowNodeStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export type WorkflowPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type WorkflowNodeState = {
  id: string;
  label?: string;
  status: WorkflowNodeStatus;
  attempt?: number;
  progress?: WorkflowProgress;
  facts?: unknown;
  warnings?: WorkflowWarning[];
  error?: WorkflowError;
};

export type WorkflowState = {
  phase: WorkflowPhase;
  nodes: Record<string, WorkflowNodeState>;
  remaining: Record<string, number>;
  error?: WorkflowError;
};

export type WorkflowCommand = { type: 'start' } | { type: 'cancel' };

export type WorkflowEvent =
  | { type: 'started' }
  | { type: 'node-attempt-started'; id: string; attempt: number }
  | { type: 'node-progress'; id: string; progress: WorkflowProgress }
  | { type: 'node-succeeded'; id: string; facts: unknown; warnings?: WorkflowWarning[] }
  | { type: 'node-failed'; id: string; fatal: boolean; error: WorkflowError }
  | { type: 'cancelled'; error?: WorkflowError };

export type WorkflowEffect = { type: 'run-node'; id: string };

export type WorkflowNodeContext<Deps = Record<string, unknown>> = {
  deps: Deps;
  signal?: AbortSignal;
  scope: Scope;
  emit(chunk: string): void;
  report(progress: WorkflowProgress): void;
};

export type WorkflowNodeOutcome<Facts = unknown> =
  | {
      status: 'done';
      facts?: Facts;
      warnings?: WorkflowWarning[];
    }
  | {
      status: 'failed';
      failure: WorkflowFailureClass;
      error: WorkflowError;
    };

export type WorkflowNodeDefinition<Deps = Record<string, unknown>, Facts = unknown> = {
  id: string;
  label?: string;
  dependsOn?: readonly string[];
  retry?: RetrySchedule;
  fatal?: boolean | ((deps: Deps) => boolean);
  run(
    ctx: WorkflowNodeContext<Deps>
  ): Promise<WorkflowNodeOutcome<Facts>> | WorkflowNodeOutcome<Facts>;
};

export function defineWorkflowNode<Deps = Record<string, unknown>, Facts = unknown>(
  node: WorkflowNodeDefinition<Deps, Facts>
): WorkflowNodeDefinition<Deps, Facts> {
  return node;
}

export type WorkflowCompileError =
  | { type: 'duplicate-node'; id: string; message: string }
  | { type: 'self-dependency'; id: string; message: string }
  | { type: 'unknown-dependency'; id: string; dependsOn: string; message: string }
  | { type: 'cycle'; cycle: readonly string[]; message: string };

export type CompiledWorkflowNode = {
  def: WorkflowNodeDefinition;
  dependents: readonly string[];
  indegree: number;
};

export type CompiledWorkflow = {
  nodes: ReadonlyMap<string, CompiledWorkflowNode>;
  order: readonly string[];
  roots: readonly string[];
};

export type WorkflowReport = {
  facts: Record<string, unknown>;
  warnings: WorkflowWarning[];
};

export type CreateWorkflowOptions = {
  nodes: readonly WorkflowNodeDefinition[];
  scope: Scope;
  clock?: Clock;
  signal?: AbortSignal;
  onOutput?: (event: { nodeId: string; chunk: string }) => void;
};

export type Workflow = {
  machine: Machine<
    WorkflowState,
    WorkflowCommand,
    WorkflowEvent,
    WorkflowEffect,
    WorkflowError,
    void
  >;
  run(): Promise<Result<WorkflowReport, WorkflowError>>;
  dispose(): void;
};
