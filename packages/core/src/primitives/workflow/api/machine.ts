import { err, ok } from '@emdash/shared';
import type { MachineDefinition, MachineEvolveResult } from '@emdash/shared/concurrency';
import type {
  CompiledWorkflow,
  WorkflowCommand,
  WorkflowEffect,
  WorkflowError,
  WorkflowEvent,
  WorkflowNodeState,
  WorkflowState,
} from './types';

export function initialWorkflowState(compiled: CompiledWorkflow): WorkflowState {
  const nodes: Record<string, WorkflowNodeState> = {};
  const remaining: Record<string, number> = {};
  for (const id of compiled.order) {
    const compiledNode = compiled.nodes.get(id);
    if (!compiledNode) continue;
    nodes[id] = {
      id,
      label: compiledNode.def.label,
      status: 'pending',
    };
    remaining[id] = compiledNode.indegree;
  }
  return { phase: 'idle', nodes, remaining };
}

export function createWorkflowMachineDefinition(
  compiled: CompiledWorkflow
): MachineDefinition<
  WorkflowState,
  WorkflowCommand,
  WorkflowEvent,
  WorkflowEffect,
  WorkflowError,
  void
> {
  return {
    decide(state, command) {
      if (command.type === 'start') {
        if (state.phase !== 'idle') {
          return err({ type: 'illegal-transition', message: 'Workflow has already started' });
        }
        return ok([{ type: 'started' }]);
      }

      if (state.phase === 'succeeded' || state.phase === 'failed' || state.phase === 'cancelled') {
        return ok([]);
      }

      return ok([{ type: 'cancelled' }]);
    },

    evolve(state, event) {
      if (isTerminal(state.phase)) return { state };

      if (event.type === 'started') {
        const next: WorkflowState = {
          ...state,
          phase: 'running',
        };
        if (compiled.order.length === 0) {
          return { state: { ...next, phase: 'succeeded' } };
        }
        return schedule(next, compiled.roots, compiled);
      }

      if (event.type === 'node-attempt-started') {
        const node = state.nodes[event.id];
        if (!node || node.status !== 'running') return { state };
        return updateNode(state, event.id, {
          ...node,
          attempt: event.attempt,
          progress: undefined,
          error: undefined,
        });
      }

      if (event.type === 'node-progress') {
        const node = state.nodes[event.id];
        if (!node || node.status !== 'running') return { state };
        return updateNode(state, event.id, {
          ...node,
          progress: event.progress,
        });
      }

      if (event.type === 'node-succeeded') {
        const node = state.nodes[event.id];
        if (!node || node.status !== 'running') return { state };
        const succeeded = setNode(state, event.id, {
          ...node,
          status: 'done',
          facts: event.facts,
          warnings: event.warnings,
          progress: undefined,
          error: undefined,
        });
        return unblockDependents(succeeded, event.id, compiled);
      }

      if (event.type === 'node-failed') {
        const node = state.nodes[event.id];
        if (!node || node.status !== 'running') return { state };

        if (!event.fatal) {
          const warnings = [
            ...(node.warnings ?? []),
            { type: event.error.type, message: event.error.message },
          ];
          const completed = setNode(state, event.id, {
            ...node,
            status: 'done',
            facts: {},
            warnings,
            progress: undefined,
            error: undefined,
          });
          return unblockDependents(completed, event.id, compiled);
        }

        const failed = setNode(state, event.id, {
          ...node,
          status: 'failed',
          progress: undefined,
          error: event.error,
        });
        return {
          state: {
            ...skipIncomplete(failed),
            phase: 'failed',
            error: event.error,
          },
        };
      }

      if (event.type === 'cancelled') {
        return {
          state: {
            ...skipIncomplete(state),
            phase: 'cancelled',
            error: event.error,
          },
        };
      }

      return { state };
    },
  };
}

function unblockDependents(
  state: WorkflowState,
  id: string,
  compiled: CompiledWorkflow
): MachineEvolveResult<WorkflowState, WorkflowEffect> {
  const remaining = { ...state.remaining };
  const candidates: string[] = [];
  const compiledNode = compiled.nodes.get(id);
  for (const dependent of compiledNode?.dependents ?? []) {
    const next = (remaining[dependent] ?? 0) - 1;
    remaining[dependent] = next;
    if (next === 0) candidates.push(dependent);
  }

  const withRemaining = { ...state, remaining };
  if (isComplete(withRemaining)) {
    return { state: { ...withRemaining, phase: 'succeeded' } };
  }
  return schedule(withRemaining, candidates, compiled);
}

function schedule(
  state: WorkflowState,
  candidates: readonly string[],
  compiled: CompiledWorkflow
): MachineEvolveResult<WorkflowState, WorkflowEffect> {
  const nodes = { ...state.nodes };
  const effects: WorkflowEffect[] = [];
  const candidateSet = new Set(candidates);

  for (const id of compiled.order) {
    if (!candidateSet.has(id)) continue;
    const node = nodes[id];
    if (!node || node.status !== 'pending') continue;
    nodes[id] = { ...node, status: 'running' };
    effects.push({ type: 'run-node', id });
  }

  return { state: { ...state, nodes }, effects };
}

function updateNode(
  state: WorkflowState,
  id: string,
  node: WorkflowNodeState
): MachineEvolveResult<WorkflowState, WorkflowEffect> {
  return { state: setNode(state, id, node) };
}

function setNode(state: WorkflowState, id: string, node: WorkflowNodeState): WorkflowState {
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [id]: node,
    },
  };
}

function skipIncomplete(state: WorkflowState): WorkflowState {
  const nodes: WorkflowState['nodes'] = {};
  for (const [id, node] of Object.entries(state.nodes)) {
    nodes[id] =
      node.status === 'done' || node.status === 'failed'
        ? node
        : { ...node, status: 'skipped', progress: undefined };
  }
  return { ...state, nodes };
}

function isComplete(state: WorkflowState): boolean {
  return Object.values(state.nodes).every(
    (node) => node.status === 'done' || node.status === 'skipped'
  );
}

function isTerminal(phase: WorkflowState['phase']): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
}
