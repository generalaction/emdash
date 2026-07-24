import { err, ok, type Result } from '@emdash/shared';
import { createMachine, createMachineEffectDriver } from '@emdash/shared/concurrency';
import { retry, retrySchedules, systemClock, type RetryAttempt } from '@emdash/shared/scheduling';
import { compileWorkflow } from './compile';
import { createWorkflowMachineDefinition, initialWorkflowState } from './machine';
import type {
  CompiledWorkflow,
  CreateWorkflowOptions,
  Workflow,
  WorkflowCompileError,
  WorkflowEffect,
  WorkflowError,
  WorkflowNodeContext,
  WorkflowNodeDefinition,
  WorkflowNodeOutcome,
  WorkflowReport,
  WorkflowState,
} from './types';

const CANCELLED_ERROR: WorkflowError = {
  type: 'cancelled',
  message: 'Workflow was cancelled',
};

export function createWorkflow(
  options: CreateWorkflowOptions
): Result<Workflow, WorkflowCompileError> {
  const compiled = compileWorkflow(options.nodes);
  if (!compiled.success) return compiled;

  const clock = options.clock ?? systemClock;
  const signal = options.signal ?? options.scope.signal;
  const machine = createMachine(
    createWorkflowMachineDefinition(compiled.data),
    initialWorkflowState(compiled.data)
  );

  const driver = createMachineEffectDriver<WorkflowEffect>({
    interpret(effect) {
      if (effect.type !== 'run-node') return;
      const node = compiled.data.nodes.get(effect.id)?.def;
      if (!node) return;
      void runNode(node, effect.id, compiled.data, machine.current, {
        clock,
        signal,
        scope: options.scope,
        onOutput: options.onOutput,
        apply: machine.apply,
      });
    },
  });

  const unsubscribe = machine.subscribe((batch) => {
    driver.run(batch.effects);
  });

  const onAbort = () => {
    machine.dispatch({ type: 'cancel' }, undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  return ok({
    machine,
    async run() {
      if (signal?.aborted) {
        machine.dispatch({ type: 'cancel' }, undefined);
      } else {
        const started = machine.dispatch({ type: 'start' }, undefined);
        if (!started.success) return err(started.error);
      }

      const terminal = isTerminal(machine.current())
        ? machine.current()
        : await waitForTerminal(machine);

      if (terminal.phase === 'succeeded') return ok(reportFor(terminal));
      return err(terminal.error ?? CANCELLED_ERROR);
    },
    dispose() {
      signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      driver.dispose();
      machine.dispose();
    },
  });
}

async function runNode(
  node: WorkflowNodeDefinition,
  id: string,
  compiled: CompiledWorkflow,
  current: () => WorkflowState,
  deps: {
    clock: NonNullable<CreateWorkflowOptions['clock']>;
    signal?: AbortSignal;
    scope: CreateWorkflowOptions['scope'];
    onOutput?: CreateWorkflowOptions['onOutput'];
    apply: Workflow['machine']['apply'];
  }
): Promise<void> {
  const nodeDeps = dependencyFacts(id, compiled, current());
  const context: WorkflowNodeContext = {
    deps: nodeDeps,
    signal: deps.signal,
    scope: deps.scope,
    emit(chunk) {
      deps.onOutput?.({ nodeId: id, chunk });
    },
    report(progress) {
      deps.apply({ type: 'node-progress', id, progress });
    },
  };

  const outcome = await runNodeWithRetry(node, context, {
    clock: deps.clock,
    signal: deps.signal,
    onAttempt: ({ attempt }) => {
      deps.apply({ type: 'node-attempt-started', id, attempt: attempt + 1 });
    },
  });

  if (outcome.status === 'done') {
    deps.apply({
      type: 'node-succeeded',
      id,
      facts: outcome.facts ?? {},
      warnings: outcome.warnings,
    });
    return;
  }

  deps.apply({
    type: 'node-failed',
    id,
    fatal: resolveFatal(node, nodeDeps),
    error: outcome.error,
  });
}

async function runNodeWithRetry(
  node: WorkflowNodeDefinition,
  context: WorkflowNodeContext,
  options: {
    clock: NonNullable<CreateWorkflowOptions['clock']>;
    signal?: AbortSignal;
    onAttempt: (attempt: RetryAttempt) => void;
  }
): Promise<WorkflowNodeOutcome> {
  try {
    return await retry(
      async (attempt) => {
        options.onAttempt(attempt);
        const outcome = await node.run(context);
        if (outcome.status === 'failed' && outcome.failure === 'transient') {
          throw new TransientNodeFailure(outcome);
        }
        return outcome;
      },
      {
        clock: options.clock,
        signal: options.signal,
        schedule: node.retry ?? retrySchedules.never(),
        shouldRetry(error) {
          return error instanceof TransientNodeFailure;
        },
      }
    );
  } catch (error) {
    if (error instanceof TransientNodeFailure) return error.outcome;
    if (options.signal?.aborted) {
      return { status: 'failed', failure: 'permanent', error: CANCELLED_ERROR };
    }
    return {
      status: 'failed',
      failure: 'permanent',
      error: toWorkflowError(error),
    };
  }
}

function dependencyFacts(
  id: string,
  compiled: CompiledWorkflow,
  state: WorkflowState
): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const node = compiled.nodes.get(id);
  for (const dependency of node?.def.dependsOn ?? []) {
    facts[dependency] = state.nodes[dependency]?.facts ?? {};
  }
  return facts;
}

function resolveFatal(node: WorkflowNodeDefinition, deps: Record<string, unknown>): boolean {
  if (typeof node.fatal === 'function') {
    try {
      return node.fatal(deps);
    } catch {
      return true;
    }
  }
  return node.fatal ?? true;
}

function reportFor(state: WorkflowState): WorkflowReport {
  const facts: Record<string, unknown> = {};
  const warnings: WorkflowReport['warnings'] = [];
  for (const node of Object.values(state.nodes)) {
    if (node.facts !== undefined) facts[node.id] = node.facts;
    if (node.warnings) warnings.push(...node.warnings);
  }
  return { facts, warnings };
}

function waitForTerminal(machine: Workflow['machine']): Promise<WorkflowState> {
  return new Promise((resolve) => {
    const unsubscribe = machine.subscribe((batch) => {
      if (!isTerminal(batch.state)) return;
      unsubscribe();
      resolve(batch.state);
    });
  });
}

function isTerminal(state: WorkflowState): boolean {
  return state.phase === 'succeeded' || state.phase === 'failed' || state.phase === 'cancelled';
}

function toWorkflowError(error: unknown): WorkflowError {
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

class TransientNodeFailure extends Error {
  constructor(readonly outcome: Extract<WorkflowNodeOutcome, { status: 'failed' }>) {
    super(outcome.error.message);
  }
}
