import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import {
  createLiveJobReplica,
  LiveJobFailedError,
  LiveState,
  type Contract,
  type ContractImpl,
  type JobError,
  type JobInput,
  type JobProgress,
  type JobResult,
  type LeasedLiveModelProvider,
  type LiveJobClientHandle,
  type LiveJobContext,
  type LiveJobEndpointDef,
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
  isWorkspacesRuntimeResolveError,
  throwWorkspacesRuntimeResolveError,
  workspaceRuntimeContract as workspaceContract,
  type WorkspacesHostRuntimesClient,
  type WorkspacesIdentityResolver,
  type WorkspacesRuntimeBroker,
  type WorkspacesRuntimeError,
  type WorkspacesRuntimeOperationResult as WorkspaceOperationResult,
  type WorkspacesRuntimeResolveError as RuntimeResolveError,
} from '@core/features/workspaces/api/runtime-adapter';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import {
  operationsService,
  type OperationsService,
} from '@main/core/operations/operations-service';
import { taskProvisionEvents } from '@main/core/tasks/task-provision-events';
import {
  runCloneRepositoryProvision,
  type CloneRepositoryProvisionInput,
} from '@main/core/workspaces/workspace-bootstrap-service';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';

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

export type CreateWorkspacesWireControllerOptions = {
  provisionTask: WorkspacesWireTaskProvisioner;
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
  const unsubscribeProgress = taskProvisionEvents.on('progress', (progress) => {
    void publishTaskProgress(progress.taskId, {
      step: progress.step,
      message: progress.message,
      operation: progress.operation,
    });
  });
  const unsubscribeReady = options.onTaskWorkspaceReady((taskId, result) => {
    void publishTaskReady(taskId, result);
  });

  return {
    impl: {
      runtime: createWorkspaceRuntimeProvider(options),
      bootstrap: createBootstrapProvider(),
      provision: {
        run: (input, ctx) => runProvisionJob(options, input, ctx),
        toError: unknownToWorkspaceError,
      },
      provisionClone: {
        run: (input, ctx) => runProvisionCloneJob(input, ctx),
        toError: unknownToWorkspaceError,
      },
      activate: job<typeof workspacesWireContract.activate>((input, ctx) =>
        runWorkspaceRuntimeJob<
          typeof workspacesWireContract.activate,
          typeof workspaceContract.activate,
          typeof input
        >(
          options,
          workspaceContract.activate,
          input,
          ctx,
          (client) => client.workspace.activate,
          (mapped) => ({
            workspace: mapped.workspace,
            consumerId: input.consumerId,
          })
        )
      ),
      deactivate: job<typeof workspacesWireContract.deactivate>((input, ctx) =>
        runWorkspaceRuntimeJob<
          typeof workspacesWireContract.deactivate,
          typeof workspaceContract.deactivate,
          typeof input
        >(
          options,
          workspaceContract.deactivate,
          input,
          ctx,
          (client) => client.workspace.deactivate,
          (mapped) => ({
            workspace: mapped.workspace,
            consumerId: input.consumerId,
            strategy: input.strategy,
          })
        )
      ),
      teardown: job<typeof workspacesWireContract.teardown>((input, ctx) =>
        runWorkspaceRuntimeJob<
          typeof workspacesWireContract.teardown,
          typeof workspaceContract.teardown,
          typeof input
        >(
          options,
          workspaceContract.teardown,
          input,
          ctx,
          (client) => client.workspace.teardown,
          (mapped) => ({
            workspace: mapped.workspace,
            force: input.force,
          })
        )
      ),
      cleanArtifacts: job<typeof workspacesWireContract.cleanArtifacts>((input, ctx) =>
        runWorkspaceRuntimeJob<
          typeof workspacesWireContract.cleanArtifacts,
          typeof workspaceContract.cleanArtifacts,
          typeof input
        >(
          options,
          workspaceContract.cleanArtifacts,
          input,
          ctx,
          (client) => client.workspace.cleanArtifacts,
          async (mapped) => {
            const repository = await requireWorkspaceIdentity(
              options.workspaceIdentity.resolveProject(mapped.identity.projectId)
            );
            return {
              workspace: mapped.workspace,
              repoPath: workspaceRef(repository),
              preservePatterns: input.preservePatterns,
            };
          }
        )
      ),
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
      delete: async (input) => {
        await operationsService.initialize();
        return operationsService.enqueueDeleteWorkspace(input.workspaceId);
      },
      archive: async (input) => {
        await operationsService.initialize();
        return operationsService.enqueueArchiveWorkspace(input);
      },
      retryDelete: async (input) => {
        await operationsService.initialize();
        return operationsService.retryDelete('workspace', input.workspaceId);
      },
      forgetWithoutCleanup: async (input) => {
        await operationsService.initialize();
        return operationsService.forgetWithoutCleanup('workspace', input.workspaceId);
      },
      deletions: createWorkspaceDeletionsProvider(),
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
): LeasedLiveModelProvider<typeof workspacesWireContract.runtime> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: workspacesWireContract.runtime,
    acquireState: (key, name) =>
      acquireRuntimeSource(options, key.workspaceId, (client, identity) =>
        client.workspace.workspace.state(workspaceRef(identity), name).asLiveSource()
      ),
    async runMutation() {
      throw new Error('Workspace runtime model has no mutations');
    },
    async dispose() {},
  };
}

function job<Def extends LiveJobEndpointDef>(
  run: (
    input: JobInput<Def>,
    context: LiveJobContext<JobProgress<Def>>
  ) => Promise<Result<JobResult<Def>, JobError<Def>>>
): { run: typeof run } {
  return { run };
}

async function runWorkspaceRuntimeJob<
  TargetDef extends LiveJobEndpointDef,
  SourceDef extends LiveJobEndpointDef,
  Input extends { workspaceId: string },
>(
  options: CreateWorkspacesWireControllerOptions,
  sourceDefinition: SourceDef,
  input: Input,
  context: LiveJobContext<JobProgress<TargetDef>>,
  handle: (client: WorkspacesHostRuntimesClient) => LiveJobClientHandle<SourceDef>,
  mapInput: (mapped: {
    identity: Awaited<ReturnType<WorkspacesIdentityResolver['resolve']>> & {};
    workspace: ReturnType<typeof hostFileRefFromNativePath>;
  }) => JobInput<SourceDef> | Promise<JobInput<SourceDef>>
): Promise<Result<JobResult<TargetDef>, JobError<TargetDef>>> {
  const result = await withWorkspaceRuntime(
    options,
    input.workspaceId,
    async (client, identity) => {
      const jobs = createLiveJobReplica(sourceDefinition, handle(client));
      const lease = await jobs.start(
        await mapInput({ identity, workspace: workspaceRef(identity) })
      );
      try {
        const job = await lease.ready();
        const unsubscribe = job.onProgress((progress) =>
          context.progress(progress as unknown as JobProgress<TargetDef>)
        );
        const cancel = () => void job.cancel();
        context.signal.addEventListener('abort', cancel, { once: true });
        if (context.signal.aborted) cancel();
        try {
          const result = (await job.result) as JobResult<SourceDef> & {
            workspace?: unknown;
          };
          const { workspace: _, ...rest } = result;
          return ok({ ...rest, workspaceId: input.workspaceId } as JobResult<TargetDef>);
        } catch (error) {
          if (error instanceof LiveJobFailedError) {
            return err(error.error as JobError<TargetDef>);
          }
          throw error;
        } finally {
          context.signal.removeEventListener('abort', cancel);
          unsubscribe();
        }
      } finally {
        await lease.release();
        await jobs.dispose();
      }
    }
  );
  return result as Result<JobResult<TargetDef>, JobError<TargetDef>>;
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
  const lease = options.runtimes.session(identity.host);
  try {
    const runtime = await lease.ready();
    if (!runtime.success) return err(runtime.error);
    return await work(runtime.data, identity);
  } finally {
    await lease.release();
  }
}

function acquireRuntimeSource(
  options: CreateWorkspacesWireControllerOptions,
  workspaceId: string,
  source: (
    client: WorkspacesHostRuntimesClient,
    identity: NonNullable<Awaited<ReturnType<WorkspacesIdentityResolver['resolve']>>>
  ) => LiveSource
): PendingLease<LiveSource> {
  const acquired = (async () => {
    const identity = await requireWorkspaceIdentity(options.workspaceIdentity.resolve(workspaceId));
    const lease = options.runtimes.session(identity.host);
    return { identity, lease, ready: lease.ready() };
  })();
  return {
    async ready() {
      const { identity, ready } = await acquired;
      const runtime = await ready;
      if (!runtime.success) throwWorkspacesRuntimeResolveError(runtime.error);
      return source(runtime.data, identity);
    },
    async release() {
      const { lease } = await acquired;
      await lease.release();
    },
  };
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

function createWorkspaceDeletionsProvider(): LeasedLiveModelProvider<
  typeof workspacesWireContract.deletions
> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: workspacesWireContract.deletions,
    acquireState(key, name) {
      let lease: ReturnType<OperationsService['acquireDeletionState']> | undefined;
      let released = false;
      return {
        ready: async () => {
          if (name !== 'list') {
            throw new Error(`Unknown workspace deletion state '${String(name)}'`);
          }
          if (released) throw new Error('Workspace deletion state lease was released before ready');
          await operationsService.initialize();
          lease ??= operationsService.acquireDeletionState('workspace', key.entityId);
          if (released) {
            await lease.release();
            throw new Error('Workspace deletion state lease was released before ready');
          }
          return lease.ready();
        },
        release: async () => {
          released = true;
          await lease?.release();
        },
      };
    },
    async runMutation() {
      throw new Error('Workspace deletions model does not expose mutations');
    },
    async dispose() {},
  };
}

function createBootstrapProvider(): LeasedLiveModelProvider<
  typeof workspacesWireContract.bootstrap
> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: workspacesWireContract.bootstrap,
    acquireState(key, name) {
      return {
        ready: async () => {
          if (name !== 'state') throw new Error(`Unknown bootstrap state '${String(name)}'`);
          return await ensureBootstrapState(key);
        },
        release: async () => {},
      };
    },
    async runMutation() {
      throw new Error('Workspace bootstrap model does not expose mutations');
    },
    async dispose() {
      bootstrapStates.clear();
    },
  };
}

async function runProvisionJob(
  options: CreateWorkspacesWireControllerOptions,
  input: { workspaceId: string; taskId?: string },
  ctx: LiveJobContext<WorkspaceBootstrapProgress>
): Promise<Result<WorkspaceProvisionResult, WorkspaceSliceError>> {
  const taskId = input.taskId ?? (await resolveTaskIdForWorkspace(input.workspaceId));
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
  input: CloneRepositoryProvisionInput,
  ctx: LiveJobContext<WorkspaceBootstrapProgress>
): Promise<Result<WorkspaceCloneProvisionResult, WorkspaceSliceError>> {
  return runCloneRepositoryProvision({
    ...input,
    signal: ctx.signal,
    onProgress(progress) {
      ctx.progress(progress);
    },
  });
}

async function publishTaskProgress(
  taskId: string,
  progress: WorkspaceBootstrapProgress
): Promise<void> {
  const active = activeProvisionJobs.get(taskId);
  const workspaceId = active?.workspaceId ?? (await resolveWorkspaceIdForTask(taskId));
  if (!workspaceId) return;
  active?.progress(progress);
  publishBootstrapState(workspaceId, { status: 'provisioning', progress });
}

async function publishTaskReady(taskId: string, result: WorkspaceProvisionResult): Promise<void> {
  const workspaceId = result.workspaceId || (await resolveWorkspaceIdForTask(taskId));
  if (!workspaceId) return;
  publishBootstrapState(workspaceId, { status: 'ready', result });
}

async function ensureBootstrapState(key: BootstrapKey): Promise<BootstrapState> {
  const existing = bootstrapStates.get(key.workspaceId);
  if (existing) return existing;

  const state = new LiveState<WorkspaceBootstrapState>(
    await hydrateBootstrapState(key.workspaceId)
  );
  bootstrapStates.set(key.workspaceId, state);
  return state;
}

async function hydrateBootstrapState(workspaceId: string): Promise<WorkspaceBootstrapState> {
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

async function resolveTaskIdForWorkspace(workspaceId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  return row?.id;
}

async function resolveWorkspaceIdForTask(taskId: string): Promise<string | undefined> {
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
