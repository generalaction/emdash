import type { Result } from '@emdash/shared';
import { type Contract, type ContractImpl } from '@emdash/wire';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  workspacesWireContract,
  WorkspaceError,
  WorkspaceProvisionResult,
  WorkspaceSliceError,
} from '@core/features/workspaces/api';
import {
  enqueueArchiveWorkspace,
  enqueueDeleteWorkspace,
} from '@core/features/workspaces/api/node/operations/workspace-removal';
import { isWorkspacesRuntimeResolveError } from '@core/features/workspaces/api/runtime-adapter';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';

type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type WorkspacesWireImpl = ContractImpl<ContractDefinitionsOf<typeof workspacesWireContract>>;

export type WorkspacesWireTaskProvisioner = (
  taskId: string,
  signal?: AbortSignal,
  operationId?: string
) => Promise<Result<WorkspaceProvisionResult, WorkspaceSliceError>>;

export type CreateWorkspacesWireControllerOptions = {
  db: AppDb;
  operations: OperationsEngine;
  provisionTask: WorkspacesWireTaskProvisioner;
  reprovisionWorkspace(
    workspaceId: string,
    options?: { removeFirst?: boolean }
  ): ReturnType<OperationsEngine['submit']>;
};

export type WorkspacesWireController = {
  impl: WorkspacesWireImpl;
  dispose(): Promise<void>;
};

export function createWorkspacesWireController(
  options: CreateWorkspacesWireControllerOptions
): WorkspacesWireController {
  return {
    impl: {
      provision: {
        run: (input, ctx) => runProvisionJob(options, input, ctx.signal),
        toError: unknownToWorkspaceError,
      },
      reprovision: (input) => options.reprovisionWorkspace(input.workspaceId),
      removeAndReprovision: (input) =>
        options.reprovisionWorkspace(input.workspaceId, { removeFirst: true }),
      delete: (input) => enqueueDeleteWorkspace(options.operations, input.workspaceId),
      archive: (input) => enqueueArchiveWorkspace(options.operations, input),
    },
    async dispose() {},
  };
}

async function runProvisionJob(
  options: CreateWorkspacesWireControllerOptions,
  input: { workspaceId: string; taskId?: string; operationId?: string },
  signal?: AbortSignal
): Promise<Result<WorkspaceProvisionResult, WorkspaceSliceError>> {
  const taskId = input.taskId ?? (await resolveTaskIdForWorkspace(options.db, input.workspaceId));
  if (!taskId) {
    return {
      success: false,
      error: workspaceError('missing-task', `No task is linked to workspace ${input.workspaceId}`),
    };
  }
  return options.provisionTask(taskId, signal, input.operationId);
}

async function resolveTaskIdForWorkspace(
  db: AppDb,
  workspaceId: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  return row?.id;
}

function workspaceError(type: string, message: string): WorkspaceError {
  return { type, message };
}

function unknownToWorkspaceError(error: unknown): WorkspaceSliceError {
  if (isWorkspacesRuntimeResolveError(error)) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as WorkspaceError;
  }
  return workspaceError(
    'workspace-wire-error',
    error instanceof Error ? error.message : String(error)
  );
}

export function provisionWorkspaceErrorToWorkspaceError(error: unknown): WorkspaceSliceError {
  if (isWorkspacesRuntimeResolveError(error)) return error;
  if (typeof error !== 'object' || error === null) {
    return workspaceError('workspace-provision-failed', String(error));
  }
  const type = (error as { type?: unknown }).type;
  if (type === 'no-intent') return workspaceError('no-intent', 'Workspace has no setup intent');
  if (type === 'missing-workspace') {
    return workspaceError('missing-workspace', 'Workspace row is missing');
  }
  if (type === 'cancelled') {
    const cancelled = error as { message?: unknown };
    return workspaceError(
      'cancelled',
      typeof cancelled.message === 'string' ? cancelled.message : 'Workspace setup was cancelled'
    );
  }
  if (type === 'setup-failed') {
    const setupError = error as { stepKind?: unknown; stepErrorType?: unknown; message?: unknown };
    return {
      type: 'setup-failed',
      stageId: typeof setupError.stepKind === 'string' ? setupError.stepKind : undefined,
      message:
        typeof setupError.message === 'string'
          ? setupError.message
          : `Workspace setup failed during ${String(setupError.stepKind ?? 'unknown step')}`,
      resolutions:
        typeof setupError.stepErrorType === 'string' ? [setupError.stepErrorType] : undefined,
    };
  }
  return unknownToWorkspaceError(error);
}
