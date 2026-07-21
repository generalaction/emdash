import crypto from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { conversationWireEvents } from '@core/features/conversations/api/node';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { mapTaskRowToTask } from '@core/features/tasks/api/node/utils/utils';
import type { ConversationConfig } from '@core/primitives/conversations/api';
import type { Conversation } from '@core/primitives/conversations/api';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  TaskLifecycleStatus,
} from '@core/primitives/tasks/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { conversations, projects, tasks, workspaces } from '@core/services/app-db/node/schema';
import type { ConversationRow, TaskRow } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';

type ConvInsert = typeof conversations.$inferInsert;

export interface PreparedCreateTask {
  params: CreateTaskParams;
  initialStatus: TaskLifecycleStatus;
  workspaceId: string;
  newWorkspaceValues: typeof workspaces.$inferInsert | null;
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
  params: CreateTaskParams
): Promise<Result<PreparedCreateTask, CreateTaskError>> {
  if (!projectSessions.getProject(params.projectId)) {
    return err({ type: 'project-not-found' });
  }

  const { workspaceConfig } = params;
  const initialStatus: TaskLifecycleStatus = params.taskConfig.initialStatus ?? 'in_progress';

  let workspaceId: string;
  let newWorkspaceValues: typeof workspaces.$inferInsert | null = null;

  const wsTarget = workspaceConfig.workspace;
  const branchName =
    workspaceConfig.git.kind === 'use-branch' || workspaceConfig.git.kind === 'create-branch'
      ? workspaceConfig.git.branchName
      : workspaceConfig.git.kind === 'pr-branch'
        ? (workspaceConfig.git.taskBranch ?? workspaceConfig.git.headBranch)
        : undefined;
  const cleanupReady = await operations.waitForConflictingCleanup({
    projectId: params.projectId,
    workspaceId: wsTarget.kind === 'repository-instance' ? wsTarget.workspaceId : undefined,
    branchName,
  });
  if (!cleanupReady) {
    return err({
      type: 'provision-failed',
      message: 'A previous cleanup for this workspace is waiting for review or connectivity.',
    });
  }

  if (wsTarget.kind === 'repository-instance') {
    workspaceId = wsTarget.workspaceId;
  } else {
    workspaceId = crypto.randomUUID();

    if (wsTarget.kind === 'byoi') {
      newWorkspaceValues = {
        id: workspaceId,
        kind: 'byoi',
        location: 'remote',
        type: 'byoi',
        config: workspaceConfig,
      };
    } else {
      // 'new-worktree' — derive location from the project.
      const [projectRow] = await db
        .select({
          workspaceProvider: projects.workspaceProvider,
          sshConnectionId: projects.sshConnectionId,
        })
        .from(projects)
        .where(and(eq(projects.id, params.projectId), isNull(projects.deletedAt)))
        .limit(1);

      const isRemote = projectRow?.workspaceProvider === 'ssh';
      const location = isRemote ? 'remote' : 'local';
      const sshConnectionId = isRemote ? (projectRow?.sshConnectionId ?? null) : null;
      const legacyType = isRemote ? 'project-ssh' : 'local';

      newWorkspaceValues = {
        id: workspaceId,
        kind: 'worktree',
        location,
        sshConnectionId,
        type: legacyType,
        config: workspaceConfig,
      };
    }
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

  return ok({ params, initialStatus, workspaceId, newWorkspaceValues, convInsert });
}

/**
 * Synchronously runs the task/workspace/conversation inserts within the provided
 * transaction. Must be called with a `PreparedCreateTask` from `prepareCreateTask`.
 * Returns the raw DB rows; call `finalizeCreateTask` after the transaction commits
 * to build the result and emit side-effect events.
 */
export function commitCreateTask(
  prepared: PreparedCreateTask,
  tx: DrizzleTx
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
    tx.insert(workspaces).values(newWorkspaceValues).run();
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
  }

  return { task: { ...task, workspaceId: prepared.workspaceId }, initialConversation };
}

export async function createTask(
  db: AppDb,
  projects: Pick<ProjectSessionManager, 'getProject'>,
  operations: OperationsEngine,
  params: CreateTaskParams
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  const prepared = await prepareCreateTask(db, projects, operations, params);
  if (!prepared.success) return prepared;

  let taskRow!: TaskRow;
  let convRow: ConversationRow | undefined;
  db.transaction((tx) => {
    ({ taskRow, convRow } = commitCreateTask(prepared.data, tx));
  });

  return ok(finalizeCreateTask(prepared.data, taskRow, convRow));
}
