import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import type { Result } from '@emdash/shared';
import { LiveState } from '@emdash/wire';
import type { Contract, ContractImpl, LeasedLiveModelProvider, LiveJobContext } from '@emdash/wire';
import { eq } from 'drizzle-orm';
import { taskProvisionEvents } from '@main/core/tasks/task-provision-events';
import {
  runCloneRepositoryProvision,
  type CloneRepositoryProvisionInput,
} from '@main/core/workspaces/workspace-bootstrap-service';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import {
  workspacesWireContract,
  type WorkspaceBootstrapProgress,
  type WorkspaceBootstrapState,
  type WorkspaceCloneProvisionResult,
  type WorkspaceProvisionResult,
} from '@shared/core/workspaces/wire-contract';

type BootstrapKey = { workspaceId: string };
type BootstrapState = LiveState<WorkspaceBootstrapState>;
type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type WorkspacesWireImpl = ContractImpl<ContractDefinitionsOf<typeof workspacesWireContract>>;

export type WorkspacesWireTaskProvisioner = (
  taskId: string
) => Promise<Result<WorkspaceProvisionResult, WorkspaceError>>;

export type WorkspacesWireTaskReadySubscription = (
  handler: (taskId: string, result: WorkspaceProvisionResult) => void
) => () => void;

export type CreateWorkspacesWireControllerOptions = {
  provisionTask: WorkspacesWireTaskProvisioner;
  onTaskWorkspaceReady: WorkspacesWireTaskReadySubscription;
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
    });
  });
  const unsubscribeReady = options.onTaskWorkspaceReady((taskId, result) => {
    void publishTaskReady(taskId, result);
  });

  return {
    impl: {
      bootstrap: createBootstrapProvider(),
      provision: {
        run: (input, ctx) => runProvisionJob(options, input, ctx),
        toError: unknownToWorkspaceError,
      },
      provisionClone: {
        run: (input, ctx) => runProvisionCloneJob(input, ctx),
        toError: unknownToWorkspaceError,
      },
    },
    async dispose() {
      unsubscribeProgress();
      unsubscribeReady();
      bootstrapStates.clear();
      activeProvisionJobs.clear();
    },
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
): Promise<Result<WorkspaceProvisionResult, WorkspaceError>> {
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
): Promise<Result<WorkspaceCloneProvisionResult, WorkspaceError>> {
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
    .where(eq(workspaces.id, workspaceId))
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
    .where(eq(tasks.workspaceId, workspaceId))
    .limit(1);
  return row?.id;
}

async function resolveWorkspaceIdForTask(taskId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.workspaceId ?? undefined;
}

function workspaceError(type: string, message: string): WorkspaceError {
  return { type, message };
}

function unknownToWorkspaceError(error: unknown): WorkspaceError {
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

export function provisionWorkspaceErrorToWorkspaceError(error: unknown): WorkspaceError {
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
