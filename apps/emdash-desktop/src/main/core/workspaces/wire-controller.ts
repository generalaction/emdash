import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import type {
  ScriptWorkflowProgress,
  ScriptWorkflowResult,
  TerminalError,
} from '@emdash/core/services/script-workflows/api';
import type { Result } from '@emdash/shared';
import { LiveState } from '@emdash/wire';
import type { Contract, ContractImpl, LeasedLiveModelProvider, LiveJobContext } from '@emdash/wire';
import { and, eq, isNull } from 'drizzle-orm';
import type { OperationsService } from '@main/core/operations/operations-service';
import { projectManager } from '@main/core/projects/project-manager';
import { taskProvisionEvents } from '@main/core/tasks/task-provision-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { resolveLifecycleScript } from '@main/core/terminals/lifecycle-script-settings';
import { hostFileRefFromNativePath } from '@main/core/workspaces/runtime/workspace-runtime-host';
import { triggerTaskScriptWorkflow } from '@main/core/workspaces/script-workflows';
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
  type RunWorkspaceScriptWorkflowInput,
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
      operation: progress.operation,
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
      runScriptWorkflow: {
        run: (input, ctx) => runScriptWorkflowJob(input, ctx),
        toError: unknownToTerminalError,
      },
      delete: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.enqueueDeleteWorkspace(input.workspaceId);
      },
      retryDelete: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.retryDelete('workspace', input.workspaceId);
      },
      forgetWithoutCleanup: async (input) => {
        const operationsService = await getOperationsService();
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
          const operationsService = await getOperationsService();
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

async function runScriptWorkflowJob(
  input: RunWorkspaceScriptWorkflowInput,
  ctx: LiveJobContext<ScriptWorkflowProgress>
): Promise<Result<ScriptWorkflowResult, TerminalError>> {
  const [taskRow] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!taskRow) {
    return {
      success: false,
      error: terminalError('missing-task', `Task ${input.taskId} not found`),
    };
  }
  const project = projectManager.getProject(input.projectId);
  if (!project) {
    return {
      success: false,
      error: terminalError('missing-project', `Project ${input.projectId} not found`),
    };
  }
  const resolved = await resolveLifecycleScript(input);
  if (!resolved.success) {
    return {
      success: false,
      error: terminalError(resolved.error.type, formatLifecycleScriptError(resolved.error)),
    };
  }
  if (!resolved.data.script) {
    return {
      success: true,
      data: {
        workflowId: ctx.jobId,
        kind: `manual:${input.type}`,
        completedNodes: [],
      },
    };
  }

  return await triggerTaskScriptWorkflow({
    task: mapTaskRowToTask(taskRow),
    project,
    workspaceId: input.workspaceId,
    workspace: hostFileRefFromNativePath(resolved.data.workspace.path),
    cwd: resolved.data.workspace.path,
    kind: `manual:${input.type}`,
    shellSetup: resolved.data.shellSetup,
    nodes: [
      {
        id: input.type,
        label: labelForScript(input.type),
        command: resolved.data.script,
      },
    ],
    signal: ctx.signal,
    onProgress: ctx.progress,
  });
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

function workspaceError(type: string, message: string): WorkspaceError {
  return { type, message };
}

function terminalError(type: string, message: string): TerminalError {
  return { type, message };
}

function unknownToTerminalError(error: unknown): TerminalError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as TerminalError;
  }
  return terminalError(
    'terminal-wire-error',
    error instanceof Error ? error.message : String(error)
  );
}

function formatLifecycleScriptError(error: { type: string; message?: string }): string {
  return error.message ?? `Failed to resolve lifecycle script: ${error.type}`;
}

function labelForScript(type: RunWorkspaceScriptWorkflowInput['type']): string {
  return type[0]!.toUpperCase() + type.slice(1);
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

async function getOperationsService(): Promise<OperationsService> {
  return (await import('@main/core/operations/operations-service')).operationsService;
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
