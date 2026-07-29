import { err, ok, type Result } from '@emdash/shared';
import { createMachine } from '@emdash/shared/concurrency';
import type { HostFileRef } from '@primitives/path/api';
import type {
  WorkspaceActivityResource,
  WorkspaceConsumer,
  WorkspaceError,
  WorkspaceOperationKind,
  WorkspacePhase,
  WorkspaceState,
  WorkspaceTopology,
} from '@runtimes/workspace/api';
import type { RunPhaseInput } from '@runtimes/workspace/api/provisioning';
import type { RunScriptWorkflowInput } from '@services/script-workflows/api';

export type WorkspaceCommand =
  | {
      type: 'BeginOperation';
      kind: WorkspaceOperationKind;
      operationId: string;
      startedAt: number;
    }
  | {
      type: 'Provision';
      operationId: string;
      startedAt: number;
    }
  | {
      type: 'Activate';
      operationId: string;
      startedAt: number;
      consumerId: string;
    }
  | {
      type: 'Deactivate';
      operationId: string;
      startedAt: number;
    }
  | {
      type: 'Teardown';
      operationId: string;
      startedAt: number;
      force: boolean;
    }
  | {
      type: 'RequireIdleForTeardown';
      force: boolean;
    };

export type WorkspaceEvent =
  | {
      type: 'OperationStarted';
      kind: WorkspaceOperationKind;
      operationId: string;
      startedAt: number;
    }
  | {
      type: 'OperationStageChanged';
      stage: string;
    }
  | {
      type: 'TopologyObserved';
      topology: WorkspaceTopology;
    }
  | {
      type: 'ActivityObserved';
      resources: WorkspaceActivityResource[];
    }
  | {
      type: 'ConsumerActivated';
      consumer: WorkspaceConsumer;
    }
  | {
      type: 'PrepareCompleted';
    }
  | {
      type: 'PlanFinished';
      operationId: string;
      result: Result<void, WorkspaceError>;
    }
  | {
      type: 'PrepareFinished';
      operationId: string;
      result: Result<void, WorkspaceError>;
    }
  | {
      type: 'ConsumerDeactivated';
      consumerId: string;
    }
  | {
      type: 'OperationCompleted';
    }
  | {
      type: 'OperationFailed';
      error: WorkspaceError;
    };

export type WorkspaceMachineEffect =
  | {
      type: 'run-bootstrap-plan';
      operationId: string;
      input: RunPhaseInput;
    }
  | {
      type: 'run-script-workflow';
      operationId: string;
      input: RunScriptWorkflowInput;
    }
  | {
      type: 'probe';
      workspace: HostFileRef;
    }
  | {
      type: 'kill-terminal-scope';
      workspace: HostFileRef;
    }
  | {
      type: 'detach-terminal-scope';
      workspace: HostFileRef;
    };

export function initialWorkspaceState(
  workspace: HostFileRef,
  topology: WorkspaceTopology = { kind: 'missing' }
): WorkspaceState {
  return {
    workspace,
    phase: deriveWorkspacePhase({
      topology,
      operation: { kind: 'idle' },
      prepared: false,
    }),
    topology,
    operation: { kind: 'idle' },
    consumers: [],
    prepared: false,
    activity: { resources: [] },
  };
}

export function createWorkspaceMachine(workspace: HostFileRef, topology?: WorkspaceTopology) {
  return createMachine<
    WorkspaceState,
    WorkspaceCommand,
    WorkspaceEvent,
    WorkspaceMachineEffect,
    WorkspaceError,
    void
  >(
    {
      decide(state, command) {
        switch (command.type) {
          case 'BeginOperation':
            if (state.operation.kind !== 'idle') {
              return err({
                type: 'operation-in-flight',
                message: `Workspace already has an active ${state.operation.kind} operation`,
              });
            }
            return ok([
              {
                type: 'OperationStarted',
                kind: command.kind,
                operationId: command.operationId,
                startedAt: command.startedAt,
              },
            ]);

          case 'Provision':
            if (state.phase.kind !== 'unprovisioned') {
              return err(illegalTransition('provision', state.phase.kind));
            }
            return ok([
              {
                type: 'OperationStarted',
                kind: 'provision',
                operationId: command.operationId,
                startedAt: command.startedAt,
              },
            ]);

          case 'Activate':
            if (state.phase.kind !== 'provisioned' && state.phase.kind !== 'ready') {
              return err(illegalTransition('activate', state.phase.kind));
            }
            return ok([
              {
                type: 'OperationStarted',
                kind: 'activate',
                operationId: command.operationId,
                startedAt: command.startedAt,
              },
            ]);

          case 'Deactivate':
            if (state.phase.kind !== 'ready' && state.consumers.length === 0) {
              return err(illegalTransition('deactivate', state.phase.kind));
            }
            return ok([
              {
                type: 'OperationStarted',
                kind: 'deactivate',
                operationId: command.operationId,
                startedAt: command.startedAt,
              },
            ]);

          case 'Teardown': {
            const idle = requireIdleForTeardown(state, command.force);
            if (!idle.success) return idle;
            if (
              state.phase.kind !== 'provisioned' &&
              state.phase.kind !== 'ready' &&
              state.phase.kind !== 'broken' &&
              !command.force
            ) {
              return err(illegalTransition('teardown', state.phase.kind));
            }
            return ok([
              {
                type: 'OperationStarted',
                kind: 'teardown',
                operationId: command.operationId,
                startedAt: command.startedAt,
              },
            ]);
          }

          case 'RequireIdleForTeardown': {
            return requireIdleForTeardown(state, command.force);
          }
        }
      },
      evolve(state, event) {
        switch (event.type) {
          case 'OperationStarted': {
            const next = {
              ...state,
              prepared: event.kind === 'teardown' ? false : state.prepared,
              operation: {
                kind: event.kind,
                operationId: event.operationId,
                startedAt: event.startedAt,
              },
              lastError: undefined,
            };
            return { state: withDerivedPhase(next) };
          }

          case 'OperationStageChanged':
            return state.operation.kind === 'idle'
              ? { state }
              : {
                  state: withDerivedPhase({
                    ...state,
                    operation: { ...state.operation, stage: event.stage },
                  }),
                };

          case 'TopologyObserved':
            return { state: withDerivedPhase({ ...state, topology: event.topology }) };

          case 'ActivityObserved':
            return { state: { ...state, activity: { resources: event.resources } } };

          case 'ConsumerActivated': {
            const next = {
              ...state,
              consumers: [
                ...state.consumers.filter((consumer) => consumer.id !== event.consumer.id),
                event.consumer,
              ].sort((left, right) => left.id.localeCompare(right.id)),
            };
            return { state: withDerivedPhase(next) };
          }

          case 'PrepareCompleted':
            return { state: withDerivedPhase({ ...state, prepared: true }) };

          case 'PlanFinished':
            if (
              state.operation.kind === 'idle' ||
              state.operation.operationId !== event.operationId
            ) {
              return { state };
            }
            return event.result.success
              ? {
                  state: withDerivedPhase({
                    ...state,
                    operation: { kind: 'idle' },
                    lastError: undefined,
                  }),
                }
              : {
                  state: withDerivedPhase({
                    ...state,
                    operation: { kind: 'idle' },
                    lastError: event.result.error,
                  }),
                };

          case 'PrepareFinished':
            if (
              state.operation.kind !== 'activate' ||
              state.operation.operationId !== event.operationId
            ) {
              return { state };
            }
            return event.result.success
              ? { state: withDerivedPhase({ ...state, prepared: true }) }
              : {
                  state: withDerivedPhase({
                    ...state,
                    operation: { kind: 'idle' },
                    lastError: event.result.error,
                  }),
                };

          case 'ConsumerDeactivated': {
            const consumers = state.consumers.filter(
              (consumer) => consumer.id !== event.consumerId
            );
            const next = {
              ...state,
              consumers,
              prepared: consumers.length === 0 ? false : state.prepared,
            };
            return { state: withDerivedPhase(next) };
          }

          case 'OperationCompleted':
            return {
              state: withDerivedPhase({
                ...state,
                operation: { kind: 'idle' },
                lastError: undefined,
              }),
            };

          case 'OperationFailed':
            return {
              state: withDerivedPhase({
                ...state,
                operation: { kind: 'idle' },
                lastError: event.error,
              }),
            };
        }
      },
    },
    initialWorkspaceState(workspace, topology)
  );
}

export type WorkspaceMachine = ReturnType<typeof createWorkspaceMachine>;
export type WorkspaceMachineResult<T = void> = Result<T, WorkspaceError>;

function withDerivedPhase(state: WorkspaceState): WorkspaceState {
  return { ...state, phase: deriveWorkspacePhase(state) };
}

function deriveWorkspacePhase(input: {
  topology: WorkspaceTopology;
  operation: WorkspaceState['operation'];
  prepared: boolean;
  lastError?: WorkspaceError;
}): WorkspacePhase {
  if (input.lastError && input.topology.kind !== 'missing') {
    return { kind: 'broken', error: input.lastError };
  }
  switch (input.operation.kind) {
    case 'provision':
    case 'convert':
    case 'reconcile':
      return { kind: 'provisioning', jobId: input.operation.operationId };
    case 'activate':
      return { kind: 'activating', jobId: input.operation.operationId };
    case 'deactivate':
      return { kind: 'deactivating', jobId: input.operation.operationId };
    case 'teardown':
      return { kind: 'tearing-down', jobId: input.operation.operationId };
    case 'clean-artifacts':
    case 'idle':
      break;
  }
  if (input.topology.kind === 'missing') return { kind: 'unprovisioned' };
  if (input.prepared) return { kind: 'ready', prepared: true };
  return { kind: 'provisioned' };
}

function requireIdleForTeardown(
  state: WorkspaceState,
  force: boolean
): Result<readonly WorkspaceEvent[], WorkspaceError> {
  const holders = [
    ...state.consumers.map((consumer) => `consumer:${consumer.id}`),
    ...state.activity.resources.map((resource) => `${resource.runtime}:${resource.resourceId}`),
  ];
  if (holders.length === 0 || force) return ok([]);
  return err({
    type: 'workspace-busy',
    message: 'Workspace has active consumers or resources',
    holders,
    resolutions: ['force'],
  });
}

function illegalTransition(command: string, phase: WorkspacePhase['kind']): WorkspaceError {
  return {
    type: 'illegal-transition',
    message: `Cannot ${command} while workspace is ${phase}`,
  };
}
