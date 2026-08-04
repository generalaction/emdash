import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import { err, ok, type Result } from '@emdash/shared';
import {
  type Contract,
  type ContractImpl,
  type LiveModelProvider,
  type LiveSource,
} from '@emdash/wire';
import { and, eq, isNull } from 'drizzle-orm';
import {
  workspacesWireContract,
  type WorkspaceProvisionResult,
  type WorkspaceSliceError,
} from '@core/features/workspaces/api';
import {
  enqueueArchiveWorkspace,
  enqueueDeleteWorkspace,
} from '@core/features/workspaces/api/node/operations/workspace-removal';
import {
  isWorkspacesRuntimeResolveError,
  throwWorkspacesRuntimeResolveError,
  type WorkspacesHostRuntimesClient,
  type WorkspacesIdentityResolver,
  type WorkspacesRuntimeBroker,
  type WorkspacesRuntimeError,
  type WorkspacesRuntimeOperationResult as WorkspaceOperationResult,
  type WorkspacesRuntimeResolveError as RuntimeResolveError,
} from '@core/features/workspaces/api/runtime-adapter';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';
import { forwardLiveModel } from '@core/services/runtime-clients/node/forward-live-model';

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
  runtimes: WorkspacesRuntimeBroker;
  workspaceIdentity: WorkspacesIdentityResolver;
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
      runtime: createWorkspaceRuntimeProvider(options),
      provision: {
        run: (input, ctx) => runProvisionJob(options, input, ctx.signal),
        toError: unknownToWorkspaceError,
      },
      reprovision: (input) => options.reprovisionWorkspace(input.workspaceId),
      removeAndReprovision: (input) =>
        options.reprovisionWorkspace(input.workspaceId, { removeFirst: true }),
      reconcile: async (input, meta) =>
        withWorkspaceRuntime(options, input.workspaceId, async (client, identity) =>
          mapWorkspaceResult(
            input.workspaceId,
            await client.workspace.reconcile(
              { workspace: workspaceRef(identity) },
              meta.signal ? { signal: meta.signal } : undefined
            )
          )
        ),
      measureUsage: async (input, meta) =>
        withWorkspaceRuntime(options, input.workspaceId, async (client, identity) => {
          const repository = await requireWorkspaceIdentity(
            options.workspaceIdentity.resolveProject(identity.projectId)
          );
          const result = await client.workspace.measureUsage(
            {
              workspace: workspaceRef(identity),
              repoPath: workspaceRef(repository),
            },
            meta.signal ? { signal: meta.signal } : undefined
          );
          return result.success ? ok({ ...result.data, workspaceId: input.workspaceId }) : result;
        }),
      delete: (input) => enqueueDeleteWorkspace(options.operations, input.workspaceId),
      archive: (input) => enqueueArchiveWorkspace(options.operations, input),
    },
    async dispose() {},
  };
}

function createWorkspaceRuntimeProvider(
  options: CreateWorkspacesWireControllerOptions
): LiveModelProvider<typeof workspacesWireContract.runtime> {
  return forwardLiveModel(workspacesWireContract.runtime, (key, name) =>
    resolveRuntimeSource(options, key.workspaceId, (client, identity) =>
      client.workspace.workspace.state(workspaceRef(identity), name).asLiveSource()
    )
  );
}

async function withWorkspaceRuntime<T, E>(
  options: CreateWorkspacesWireControllerOptions,
  workspaceId: string,
  work: (
    client: WorkspacesHostRuntimesClient,
    identity: NonNullable<Awaited<ReturnType<WorkspacesIdentityResolver['resolve']>>>
  ) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const identity = await requireWorkspaceIdentity(options.workspaceIdentity.resolve(workspaceId));
  const runtime = await options.runtimes.client(identity.host);
  if (!runtime.success) return err(runtime.error);
  return await work(runtime.data, identity);
}

async function resolveRuntimeSource(
  options: CreateWorkspacesWireControllerOptions,
  workspaceId: string,
  source: (
    client: WorkspacesHostRuntimesClient,
    identity: NonNullable<Awaited<ReturnType<WorkspacesIdentityResolver['resolve']>>>
  ) => LiveSource
): Promise<LiveSource> {
  const identity = await requireWorkspaceIdentity(options.workspaceIdentity.resolve(workspaceId));
  const runtime = await options.runtimes.client(identity.host);
  if (!runtime.success) throwWorkspacesRuntimeResolveError(runtime.error);
  return source(runtime.data, identity);
}

async function requireWorkspaceIdentity(
  identityPromise: ReturnType<WorkspacesIdentityResolver['resolve']>
): Promise<NonNullable<Awaited<ReturnType<WorkspacesIdentityResolver['resolve']>>>> {
  const identity = await identityPromise;
  if (!identity) throw new Error('Workspace identity was not found');
  return identity;
}

function workspaceRef(
  identity: NonNullable<Awaited<ReturnType<WorkspacesIdentityResolver['resolve']>>>
) {
  return hostFileRefFromNativePath(identity.path, sshConnectionIdOf(identity.host));
}

function mapWorkspaceResult(
  workspaceId: string,
  result: Result<WorkspaceOperationResult, WorkspacesRuntimeError>
) {
  if (!result.success) return result;
  const { workspace: _, ...data } = result.data;
  return ok({ ...data, workspaceId });
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

function workspaceError(type: string, message: string): WorkspacesRuntimeError {
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
    return error as WorkspacesRuntimeError;
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
