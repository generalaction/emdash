import { err, ok, type Result } from '@emdash/shared';
import { createMachine } from '@emdash/shared/concurrency';
import type { HostFileRef } from '@primitives/path/api';
import type {
  WorkspaceActivityResource,
  WorkspaceConsumer,
  WorkspaceError,
  WorkspaceOperationKind,
  WorkspaceState,
  WorkspaceTopology,
} from '@runtimes/workspace/api';

export type WorkspaceCommand =
  | {
      type: 'BeginOperation';
      kind: WorkspaceOperationKind;
      operationId: string;
      startedAt: number;
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

export type WorkspaceMachineEffect = never;

export function initialWorkspaceState(
  workspace: HostFileRef,
  topology: WorkspaceTopology = { kind: 'missing' }
): WorkspaceState {
  return {
    workspace,
    topology,
    operation: { kind: 'idle' },
    consumers: [],
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

          case 'RequireIdleForTeardown': {
            const holders = [
              ...state.consumers.map((consumer) => `consumer:${consumer.id}`),
              ...state.activity.resources.map(
                (resource) => `${resource.runtime}:${resource.resourceId}`
              ),
            ];
            if (holders.length === 0 || command.force) return ok([]);
            return err({
              type: 'workspace-busy',
              message: 'Workspace has active consumers or resources',
              holders,
              resolutions: ['force'],
            });
          }
        }
      },
      evolve(state, event) {
        switch (event.type) {
          case 'OperationStarted':
            return {
              state: {
                ...state,
                operation: {
                  kind: event.kind,
                  operationId: event.operationId,
                  startedAt: event.startedAt,
                },
                lastError: undefined,
              },
            };

          case 'OperationStageChanged':
            return state.operation.kind === 'idle'
              ? { state }
              : { state: { ...state, operation: { ...state.operation, stage: event.stage } } };

          case 'TopologyObserved':
            return { state: { ...state, topology: event.topology } };

          case 'ActivityObserved':
            return { state: { ...state, activity: { resources: event.resources } } };

          case 'ConsumerActivated':
            return {
              state: {
                ...state,
                consumers: [
                  ...state.consumers.filter((consumer) => consumer.id !== event.consumer.id),
                  event.consumer,
                ].sort((left, right) => left.id.localeCompare(right.id)),
              },
            };

          case 'ConsumerDeactivated':
            return {
              state: {
                ...state,
                consumers: state.consumers.filter((consumer) => consumer.id !== event.consumerId),
              },
            };

          case 'OperationCompleted':
            return { state: { ...state, operation: { kind: 'idle' }, lastError: undefined } };

          case 'OperationFailed':
            return { state: { ...state, operation: { kind: 'idle' }, lastError: event.error } };
        }
      },
    },
    initialWorkspaceState(workspace, topology)
  );
}

export type WorkspaceMachine = ReturnType<typeof createWorkspaceMachine>;
export type WorkspaceMachineResult<T = void> = Result<T, WorkspaceError>;
