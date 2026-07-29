import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import { err, ok, type Result } from '@emdash/shared';
import {
  LiveState,
  type Contract,
  type ContractImpl,
  type LiveModelProvider,
  type LiveJobContext,
  type LiveSource,
} from '@emdash/wire';
import { and, eq, isNull } from 'drizzle-orm';
import {
  workspacesWireContract,
  type WorkspaceBootstrapProgress,
  type WorkspaceBootstrapState,
  type WorkspaceCloneProvisionResult,
  type WorkspaceProvisionResult,
  type WorkspaceSliceError,
} from '@core/features/workspaces/api';
import {
  runCloneRepositoryProvision,
  type CloneRepositoryProvisionInput,
} from '@core/features/workspaces/api/node/workspace-bootstrap-service';
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
import { tasks, workspaces } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';
import type { WorkspaceRuntimeClient } from '@core/services/runtime-broker/api/clients';
import {
  enqueueArchiveWorkspace,
  enqueueDeleteWorkspace,
} from './operations/workspace-lifecycle-definitions';

type BootstrapKey = { workspaceId: string };
type BootstrapState = LiveState<WorkspaceBootstrapState>;
type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type WorkspacesWireImpl = ContractImpl<ContractDefinitionsOf<typeof workspacesWireContract>>;

export type WorkspacesWireTaskProvisioner = (
  taskId: string
) => Promise<Result<WorkspaceProvisionResult, WorkspaceSliceError>>;

export type WorkspacesWireTaskReadySubscription = (
  handler: (taskId: string, result: WorkspaceProvisionResult) => void
) => () => void;

export type WorkspacesWireTaskProgressSubscription = (
  handler: (progress: WorkspaceBootstrapProgress & { taskId: string }) => void
) => () => void;

export type CreateWorkspacesWireControllerOptions = {
  db: AppDb;
  getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient>;
  operations: OperationsEngine;
  provisionTask: WorkspacesWireTaskProvisioner;
  onTaskProvisionProgress: WorkspacesWireTaskProgressSubscription;
  onTaskWorkspaceReady: WorkspacesWireTaskReadySubscription;
  runtimes: WorkspacesRuntimeBroker;
  workspaceIdentity: WorkspacesIdentityResolver;
};

export type WorkspacesWireController = {
  impl: WorkspacesWireImpl;
  dispose(): Promise<void>;
};

type ActiveProvisionJob = {
  workspaceId: string;
  progress(progress: WorkspaceBootstrapProgress): void;
};

const bootstrapStates = new Map<string, BootstrapState>();
const activeProvisionJobs = new Map<string, ActiveProvisionJob>();

export function createWorkspacesWireController(
  options: CreateWorkspacesWireControllerOptions
): WorkspacesWireController {
  const unsubscribeProgress = options.onTaskProvisionProgress((progress) => {
    void publishTaskProgress(options.db, progress.taskId, {
      step: progress.step,
      message: progress.message,
      operation: progress.operation,
    });
  });
  const unsubscribeReady = options.onTaskWorkspaceReady((taskId, result) => {
    void publishTaskReady(options.db, taskId, result);
  });

  return {
    impl: {
      runtime: createWorkspaceRuntimeProvider(options),
      bootstrap: createBootstrapProvider(options.db),
      provision: {
        run: (input, ctx) => runProvisionJob(options, input, ctx),
        toError: unknownToWorkspaceError,
      },
      provisionClone: {
        run: (input, ctx) => runProvisionCloneJob(options, input, ctx),
        toError: unknownToWorkspaceError,
      },
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
    async dispose() {
      unsubscribeProgress();
      unsubscribeReady();
      bootstrapStates.clear();
      activeProvisionJobs.clear();
    },
  };
}

function createWorkspaceRuntimeProvider(
  options: CreateWorkspacesWireControllerOptions
): LiveModelProvider<typeof workspacesWireContract.runtime> {
  return {
    kind: 'liveModelProvider',
    contract: workspacesWireContract.runtime,
    resolveState: (key, name) =>
      resolveRuntimeSource(options, key.workspaceId, (client, identity) =>
        client.workspace.workspace.state(workspaceRef(identity), name).asLiveSource()
      ),
    async runMutation() {
      throw new Error('Workspace runtime model has no mutations');
    },
  };
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

function createBootstrapProvider(
  db: AppDb
): LiveModelProvider<typeof workspacesWireContract.bootstrap> {
  return {
    kind: 'liveModelProvider',
    contract: workspacesWireContract.bootstrap,
    async resolveState(key, name) {
      if (name !== 'state') throw new Error(`Unknown bootstrap state '${String(name)}'`);
      return await ensureBootstrapState(db, key);
    },
    async runMutation() {
      throw new Error('Workspace bootstrap model does not expose mutations');
    },
  };
}

async function runProvisionJob(
  options: CreateWorkspacesWireControllerOptions,
  input: { workspaceId: string; taskId?: string },
  ctx: LiveJobContext<WorkspaceBootstrapProgress>
): Promise<Result<WorkspaceProvisionResult, WorkspaceSliceError>> {
  const taskId = input.taskId ?? (await resolveTaskIdForWorkspace(options.db, input.workspaceId));
  if (!taskId) {
    const error = workspaceError(
      'missing-task',
      `No task is linked to workspace ${input.workspaceId}`
    );
    publishBootstrapState(input.workspaceId, { status: 'error', error });
    return { success: false, error };
  }

  activeProvisionJobs.set(taskId, {
    workspaceId: input.workspaceId,
    progress: ctx.progress,
  });
  publishBootstrapState(input.workspaceId, { status: 'provisioning' });

  try {
    const result = await options.provisionTask(taskId);
    if (!result.success) {
      publishBootstrapState(input.workspaceId, { status: 'error', error: result.error });
      return result;
    }
    publishBootstrapState(input.workspaceId, { status: 'ready', result: result.data });
    return result;
  } finally {
    activeProvisionJobs.delete(taskId);
  }
}

async function runProvisionCloneJob(
  options: CreateWorkspacesWireControllerOptions,
  input: CloneRepositoryProvisionInput,
  ctx: LiveJobContext<WorkspaceBootstrapProgress>
): Promise<Result<WorkspaceCloneProvisionResult, WorkspaceSliceError>> {
  return runCloneRepositoryProvision(options.getWorkspaceRuntimeClient, {
    ...input,
    signal: ctx.signal,
    onProgress(progress) {
      ctx.progress(progress);
    },
  });
}

async function publishTaskProgress(
  db: AppDb,
  taskId: string,
  progress: WorkspaceBootstrapProgress
): Promise<void> {
  const active = activeProvisionJobs.get(taskId);
  const workspaceId = active?.workspaceId ?? (await resolveWorkspaceIdForTask(db, taskId));
  if (!workspaceId) return;
  active?.progress(progress);
  publishBootstrapState(workspaceId, { status: 'provisioning', progress });
}

async function publishTaskReady(
  db: AppDb,
  taskId: string,
  result: WorkspaceProvisionResult
): Promise<void> {
  const workspaceId = result.workspaceId || (await resolveWorkspaceIdForTask(db, taskId));
  if (!workspaceId) return;
  publishBootstrapState(workspaceId, { status: 'ready', result });
}

async function ensureBootstrapState(db: AppDb, key: BootstrapKey): Promise<BootstrapState> {
  const existing = bootstrapStates.get(key.workspaceId);
  if (existing) return existing;

  const state = new LiveState<WorkspaceBootstrapState>(
    await hydrateBootstrapState(db, key.workspaceId)
  );
  bootstrapStates.set(key.workspaceId, state);
  return state;
}

async function hydrateBootstrapState(
  db: AppDb,
  workspaceId: string
): Promise<WorkspaceBootstrapState> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);
  return workspace ? { status: 'unprovisioned' } : { status: 'unprovisioned' };
}

function publishBootstrapState(workspaceId: string, next: WorkspaceBootstrapState): void {
  const existing = bootstrapStates.get(workspaceId);
  if (existing) {
    existing.replace(next);
    return;
  }
  bootstrapStates.set(workspaceId, new LiveState(next));
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

async function resolveWorkspaceIdForTask(db: AppDb, taskId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  return row?.workspaceId ?? undefined;
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
