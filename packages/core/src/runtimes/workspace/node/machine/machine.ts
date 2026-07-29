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

export type WorkspaceCommand =
  | {
      type: 'Provision';
      operationId: string;
      startedAt: number;
    }
  | {
      type: 'Convert';
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
      type: 'CleanArtifacts';
      operationId: string;
      startedAt: number;
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

export function initialWorkspaceState(
  workspace: HostFileRef,
  topology: WorkspaceTopology = { kind: 'missing' }
): WorkspaceState {
  return {
    workspace,
    phase: deriveWorkspacePhase({
      topology,
      operation: { kind: 'idle' },
      consumers: [],
    }),
    topology,
    operation: { kind: 'idle' },
    consumers: [],
    sessionPrepared: false,
    activity: { resources: [] },
  };
}

export function createWorkspaceMachine(workspace: HostFileRef, topology?: WorkspaceTopology) {
  return createMachine<
    WorkspaceState,
    WorkspaceCommand,
    WorkspaceEvent,
    never,
    WorkspaceError,
    void
  >(
    {
      decide(state, command) {
        switch (command.type) {
          case 'Provision':
            if (state.operation.kind !== 'idle') return err(operationInFlight(state));
            if (state.phase.kind !== 'unprovisioned') {
              return err(illegalTransition('provision', state.phase.kind));
            }
            return ok([operationStarted('provision', command)]);

          case 'Convert':
            if (state.operation.kind !== 'idle') return err(operationInFlight(state));
            return ok([operationStarted('convert', command)]);

          case 'Activate':
            if (state.operation.kind !== 'idle') return err(operationInFlight(state));
            if (
              state.phase.kind !== 'provisioned' &&
              state.phase.kind !== 'ready' &&
              state.phase.kind !== 'active'
            ) {
              return err(illegalTransition('activate', state.phase.kind));
            }
            return ok([operationStarted('activate', command)]);

          case 'Deactivate':
            if (state.operation.kind !== 'idle') return err(operationInFlight(state));
            if (state.consumers.length === 0) {
              return err(illegalTransition('deactivate', state.phase.kind));
            }
            return ok([operationStarted('deactivate', command)]);

          case 'Teardown': {
            if (state.operation.kind !== 'idle') return err(operationInFlight(state));
            const idle = requireIdleForTeardown(state, command.force);
            if (!idle.success) return idle;
            if (state.phase.kind === 'unprovisioned') return ok([]);
            if (
              state.phase.kind !== 'provisioned' &&
              state.phase.kind !== 'ready' &&
              state.phase.kind !== 'active' &&
              state.phase.kind !== 'broken' &&
              !command.force
            ) {
              return err(illegalTransition('teardown', state.phase.kind));
            }
            return ok([operationStarted('teardown', command)]);
          }

          case 'CleanArtifacts':
            if (state.operation.kind !== 'idle') return err(operationInFlight(state));
            return ok([operationStarted('clean-artifacts', command)]);
        }
      },
      evolve(state, event) {
        switch (event.type) {
          case 'OperationStarted': {
            const next = {
              ...state,
              sessionPrepared: event.kind === 'teardown' ? false : state.sessionPrepared,
              operation: {
                kind: event.kind,
                operationId: event.operationId,
                startedAt: event.startedAt,
              },
              lastError: undefined,
              lastFailedOperation: undefined,
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
            return { state: withDerivedPhase({ ...state, sessionPrepared: true }) };

          case 'ConsumerDeactivated': {
            const consumers = state.consumers.filter(
              (consumer) => consumer.id !== event.consumerId
            );
            const next = {
              ...state,
              consumers,
              sessionPrepared: consumers.length === 0 ? false : state.sessionPrepared,
            };
            return { state: withDerivedPhase(next) };
          }

          case 'OperationCompleted':
            return {
              state: withDerivedPhase({
                ...state,
                operation: { kind: 'idle' },
                lastError: undefined,
                lastFailedOperation: undefined,
              }),
            };

          case 'OperationFailed':
            return {
              state: withDerivedPhase({
                ...state,
                operation: { kind: 'idle' },
                lastError: event.error,
                lastFailedOperation:
                  state.operation.kind === 'idle' ? undefined : state.operation.kind,
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
  consumers: WorkspaceConsumer[];
  lastError?: WorkspaceError;
  lastFailedOperation?: WorkspaceOperationKind;
}): WorkspacePhase {
  if (
    input.lastError &&
    (input.lastFailedOperation === 'provision' || input.lastFailedOperation === 'teardown') &&
    input.topology.kind !== 'missing'
  ) {
    return { kind: 'broken', error: input.lastError };
  }
  switch (input.operation.kind) {
    case 'provision':
    case 'convert':
      return { kind: 'provisioning', jobId: input.operation.operationId };
    case 'activate':
      return { kind: 'activating', jobId: input.operation.operationId };
    case 'deactivate':
      return { kind: 'deactivating', jobId: input.operation.operationId };
    case 'teardown':
      return { kind: 'tearing-down', jobId: input.operation.operationId };
    case 'clean-artifacts':
      return { kind: 'cleaning', jobId: input.operation.operationId };
    case 'idle':
      break;
  }
  if (input.topology.kind === 'missing') return { kind: 'unprovisioned' };
  if (input.consumers.length > 0) return { kind: 'active' };
  if (hasSetupStamp(input.topology)) return { kind: 'ready' };
  return { kind: 'provisioned' };
}

function operationStarted(
  kind: WorkspaceOperationKind,
  command: { operationId: string; startedAt: number }
): WorkspaceEvent {
  return {
    type: 'OperationStarted',
    kind,
    operationId: command.operationId,
    startedAt: command.startedAt,
  };
}

function operationInFlight(state: WorkspaceState): WorkspaceError {
  return {
    type: 'operation-in-flight',
    message: `Workspace already has an active ${state.operation.kind} operation`,
  };
}

function hasSetupStamp(topology: WorkspaceTopology): boolean {
  return topology.kind !== 'missing' && topology.setupStamp !== undefined;
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
