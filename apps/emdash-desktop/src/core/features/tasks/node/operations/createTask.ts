import crypto from 'node:crypto';
import { formatHostRef } from '@emdash/core/primitives/host/api';
import type { ResourceClaim } from '@emdash/core/primitives/kernel/api';
import { compileWorktreePayload } from '@emdash/core/services/workspace-host-actions/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { conversationWireEvents } from '@core/features/conversations/api/node';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { mapTaskRowToTask } from '@core/features/tasks/api/node/utils/utils';
import {
  hostCreateWorktreeOperation,
  type HostCreateWorktreeInput,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import { compileCreateWorktreePrediction } from '@core/features/workspaces/api/node/operations/compile-host-outbox-prediction';
import type { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import {
  createWorkspaceRegistry,
  type WorkspaceRegistry,
} from '@core/features/workspaces/api/node/registry';
import type { ConversationConfig } from '@core/primitives/conversations/api';
import type { Conversation } from '@core/primitives/conversations/api';
import {
  branchKernelClaim,
  workspaceKernelResource,
} from '@core/primitives/operations/api/resources';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  TaskLifecycleStatus,
} from '@core/primitives/tasks/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { conversations, projects, tasks } from '@core/services/app-db/node/schema';
import type { ConversationRow, TaskRow, WorkspaceInsert } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';

type ConvInsert = typeof conversations.$inferInsert;

export interface PreparedCreateTask {
  params: CreateTaskParams;
  initialStatus: TaskLifecycleStatus;
  workspaceId: string;
  newWorkspaceValues: WorkspaceInsert | null;
  createWorktreeInput?: HostCreateWorktreeInput;
  convInsert: ConvInsert | undefined;
}

/**
 * Performs all async preparation for creating a task (project validation, workspace
 * resolution). Returns a `PreparedCreateTask` that can be committed synchronously
 * inside a Drizzle transaction via `commitCreateTask`.
 */
export async function prepareCreateTask(
  db: AppDb,
  projectSessions: Pick<ProjectSessionManager, 'getProject'>,
  operations: OperationsEngine,
  placement: Pick<WorkspacePlacementResolver, 'resolveWorktreeRoot'>,
  params: CreateTaskParams
): Promise<Result<PreparedCreateTask, CreateTaskError>> {
  const project = projectSessions.getProject(params.projectId);
  if (!project) {
    return err({ type: 'project-not-found' });
  }

  const { workspaceConfig } = params;
  const initialStatus: TaskLifecycleStatus = params.taskConfig.initialStatus ?? 'in_progress';

  let workspaceId: string;
  let newWorkspaceValues: WorkspaceInsert | null = null;
  let createWorktreeInput: HostCreateWorktreeInput | undefined;

  const wsTarget = workspaceConfig.workspace;
  const branchName =
    workspaceConfig.git.kind === 'use-branch' || workspaceConfig.git.kind === 'create-branch'
      ? workspaceConfig.git.branchName
      : workspaceConfig.git.kind === 'pr-branch'
        ? (workspaceConfig.git.taskBranch ?? workspaceConfig.git.headBranch)
        : undefined;
  const claimResources: ResourceClaim[] = [];
  if (wsTarget.kind === 'repository-instance') {
    claimResources.push(
      ...workspaceKernelResource.mutates({
        projectId: params.projectId,
        workspaceId: wsTarget.workspaceId,
      })
    );
  }
  if (branchName !== undefined) {
    claimResources.push(...branchKernelClaim(params.projectId, branchName));
  }
  const claimConflict = await operations.hasClaimConflict(claimResources);
  if (claimConflict) {
    return err({
      type: 'provision-failed',
      message: 'A previous cleanup for this workspace is waiting for review or connectivity.',
    });
  }

  if (wsTarget.kind === 'repository-instance') {
    workspaceId = wsTarget.workspaceId;
  } else {
    // 'new-worktree' — derive location from the project.
    workspaceId = crypto.randomUUID();

    const [projectRow] = await db
      .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
      .from(projects)
      .where(and(eq(projects.id, params.projectId), isNull(projects.deletedAt)))
      .limit(1);

    const isRemote = project.host.type === 'remote';
    const location = isRemote ? 'remote' : 'local';
    const sshConnectionId = isRemote ? project.host.id : null;
    const legacyType = isRemote ? 'project-ssh' : 'local';

    // Task creation is UX-gated on host availability: the outbox absorbs
    // transient disconnects mid-operation, but starting new work against an
    // offline host is refused outright. Deletions never hit this gate.
    if (isRemote && !operations.hostIsReachable(formatHostRef(project.host))) {
      return err({
        type: 'provision-failed',
        message: 'The workspace host is offline. Reconnect the machine to create new tasks.',
      });
    }

    if (!branchName) {
      return err({
        type: 'provision-failed',
        message: 'A Git branch is required when creating a worktree.',
      });
    }
    const root = await placement.resolveWorktreeRoot(project.project);
    if (!root.success) {
      return err({
        type: 'provision-failed',
        message: root.error.message,
      });
    }
    const settings = await project.settings.get();
    const compiled = compileWorktreePayload({
      repoPath: project.repoPath,
      worktreeRoot: root.data,
      branchName,
      preservePatterns: settings.preservePatterns,
    });
    const registry = createWorkspaceRegistry(db);
    const workspacePath = allocateRegistryPath(
      registry,
      location,
      sshConnectionId,
      compiled.worktreePath
    );
    const gitOperation = compileGitOperation(
      workspaceConfig.git,
      pushRequested(workspaceConfig.git) ? await project.settings.getPushRemote() : undefined
    );
    const serializedHostRef = formatHostRef(project.host);
    const now = Date.now();

    newWorkspaceValues = {
      id: workspaceId,
      kind: 'worktree',
      location,
      sshConnectionId,
      parentId: projectRow?.repositoryWorkspaceId ?? null,
      type: legacyType,
      config: workspaceConfig,
      path: workspacePath,
    };
    createWorktreeInput = {
      version: '1',
      source: 'user',
      hostOperationId: crypto.randomUUID(),
      hostRef: serializedHostRef,
      repoPath: project.repoPath,
      projectId: params.projectId,
      workspaceId,
      entityName: params.taskConfig.name,
      workspacePath,
      branchName,
      startPoint: gitOperation.startPoint,
      fetch: gitOperation.fetch,
      pushRemote: gitOperation.pushRemote,
      preservePatterns: compiled.preservePatterns,
      prediction: compileCreateWorktreePrediction({
        now,
        workspacePath,
        branchName,
        fetch: gitOperation.fetch,
        pushRemote: gitOperation.pushRemote,
        preservePatterns: compiled.preservePatterns,
      }),
      createdAt: now,
    };
  }

  let convInsert: ConvInsert | undefined;
  if (params.taskConfig.initialConversation) {
    const ic = params.taskConfig.initialConversation;
    const conversationType = ic.type ?? 'pty';
    const initialQueue = ic.initialQueue?.filter((prompt) => prompt.text.trim());
    const configObj: ConversationConfig =
      conversationType === 'acp'
        ? {
            version: '1',
            type: 'acp',
            ...(ic.autoApprove !== undefined && { autoApprove: ic.autoApprove }),
            ...(initialQueue?.length && { initialQueue }),
            ...(ic.model && { model: ic.model }),
          }
        : {
            version: '1',
            type: 'pty',
            ...(ic.autoApprove !== undefined && { autoApprove: ic.autoApprove }),
            ...(ic.initialPrompt?.trim() && { initialPrompt: ic.initialPrompt.trim() }),
            ...(ic.model && { model: ic.model }),
          };
    convInsert = {
      id: ic.id,
      projectId: params.projectId,
      taskId: params.id,
      title: ic.title ?? '',
      provider: ic.provider,
      config: configObj,
      isInitialConversation: true,
      lastInteractedAt: new Date().toISOString(),
      type: conversationType,
    };
  }

  return ok({
    params,
    initialStatus,
    workspaceId,
    newWorkspaceValues,
    createWorktreeInput,
    convInsert,
  });
}

/**
 * Synchronously runs the task/workspace/conversation inserts within the provided
 * transaction. Must be called with a `PreparedCreateTask` from `prepareCreateTask`.
 * Returns the raw DB rows; call `finalizeCreateTask` after the transaction commits
 * to build the result and emit side-effect events.
 */
export function commitCreateTask(
  prepared: PreparedCreateTask,
  tx: DrizzleTx,
  registry: WorkspaceRegistry
): { taskRow: TaskRow; convRow: ConversationRow | undefined } {
  const { params, initialStatus, workspaceId, newWorkspaceValues, convInsert } = prepared;

  const [taskRow] = tx
    .insert(tasks)
    .values({
      id: params.id,
      projectId: params.projectId,
      name: params.taskConfig.name,
      status: initialStatus,
      workspaceId,
      linkedIssue: params.taskConfig.linkedIssue ?? null,
      type: 'task',
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning()
    .all();

  if (newWorkspaceValues) {
    registry.register(newWorkspaceValues, tx);
  }

  let convRow: ConversationRow | undefined;
  if (convInsert) {
    [convRow] = tx.insert(conversations).values(convInsert).returning().all();
  }

  return { taskRow, convRow };
}

/**
 * Builds the `CreateTaskSuccess` result and emits post-commit side-effect events.
 * Call this after the transaction that ran `commitCreateTask` has committed.
 */
export function finalizeCreateTask(
  prepared: PreparedCreateTask,
  taskRow: TaskRow,
  convRow: ConversationRow | undefined
): CreateTaskSuccess {
  const task = mapTaskRowToTask(taskRow);

  let initialConversation: Conversation | undefined;
  if (convRow) {
    initialConversation = mapConversationRowToConversation(convRow);
    conversationWireEvents.emit(undefined, {
      type: 'created',
      conversation: initialConversation,
    });
    appDbPokes.conversations.poke({
      projectId: prepared.params.projectId,
      taskId: prepared.params.id,
    });
  }

  appDbPokes.tasks.poke({ projectId: prepared.params.projectId, taskId: prepared.params.id });
  if (prepared.newWorkspaceValues) {
    appDbPokes.workspaces.poke({
      projectId: prepared.params.projectId,
      taskId: prepared.params.id,
      workspaceId: prepared.workspaceId,
    });
  }
  return { task: { ...task, workspaceId: prepared.workspaceId }, initialConversation };
}

export async function createTask(
  db: AppDb,
  projects: Pick<ProjectSessionManager, 'getProject'>,
  operations: OperationsEngine,
  placement: Pick<WorkspacePlacementResolver, 'resolveWorktreeRoot'>,
  params: CreateTaskParams
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  const prepared = await prepareCreateTask(db, projects, operations, placement, params);
  if (!prepared.success) return prepared;

  let taskRow!: TaskRow;
  let convRow: ConversationRow | undefined;
  const registry = createWorkspaceRegistry(db);
  if (prepared.data.createWorktreeInput) {
    const submitted = await operations.submitWithTombstone(
      hostCreateWorktreeOperation,
      prepared.data.createWorktreeInput,
      {
        tombstone: (tx) => {
          ({ taskRow, convRow } = commitCreateTask(prepared.data, tx, registry));
          return 1;
        },
        revertTombstone: (tx) => {
          registry.untrack([prepared.data.workspaceId], new Date().toISOString(), undefined, tx);
          tx.delete(conversations).where(eq(conversations.taskId, params.id)).run();
          tx.delete(tasks).where(eq(tasks.id, params.id)).run();
        },
      }
    );
    if (!submitted.success) {
      return err({ type: 'provision-failed', message: submitted.error.message });
    }
  } else {
    db.transaction((tx) => {
      ({ taskRow, convRow } = commitCreateTask(prepared.data, tx, registry));
    });
  }

  return ok(finalizeCreateTask(prepared.data, taskRow, convRow));
}

function allocateRegistryPath(
  registry: WorkspaceRegistry,
  location: NonNullable<WorkspaceInsert['location']>,
  sshConnectionId: string | null,
  basePath: string
): string {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? basePath : `${basePath}-${suffix}`;
    if (!registry.findLiveByPath(location, sshConnectionId, candidate)) return candidate;
  }
}

function pushRequested(git: CreateTaskParams['workspaceConfig']['git']): boolean {
  if (git.kind === 'create-branch') return git.pushBranch === true;
  if (git.kind === 'pr-branch') return git.pushBranch === true && git.taskBranch !== undefined;
  return false;
}

function compileGitOperation(
  git: CreateTaskParams['workspaceConfig']['git'],
  pushRemote: string | undefined
): Pick<HostCreateWorktreeInput, 'startPoint' | 'fetch' | 'pushRemote'> {
  if (git.kind === 'create-branch') {
    return {
      startPoint:
        git.fromBranch.type === 'remote'
          ? `${git.fromBranch.remote.name}/${git.fromBranch.branch}`
          : git.fromBranch.branch,
      fetch: git.fromBranch.type === 'remote',
      pushRemote,
    };
  }
  if (git.kind === 'pr-branch') {
    return { startPoint: git.taskBranch ? git.headBranch : undefined, fetch: true, pushRemote };
  }
  return {};
}
