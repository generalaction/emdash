import { randomUUID } from 'node:crypto';
import { KeyedMutex } from '@emdash/core/primitives/concurrency/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isAutomationRunAdoptable } from '@core/features/automations/api/automation-run';
import { upsertRunProjection } from '@core/features/automations/api/node/run-projection';
import { conversationWireEvents } from '@core/features/conversations/api/node';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import { mapTaskRowToTask } from '@core/features/tasks/api/node/utils/utils';
import { computeWorkspaceKey } from '@core/features/workspaces/api/node/workspace-key';
import type { AutomationAdoptionError } from '@core/primitives/automations/api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { Project } from '@core/primitives/projects/api';
import type { Task } from '@core/primitives/tasks/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  conversations,
  tasks,
  workspaces,
  type ConversationRow,
  type TaskRow,
} from '@core/services/app-db/node/schema';
import {
  automationRunMetaForRun,
  conversationForRun,
  storedWorkspaceConfigForRun,
  taskParamsForRun,
} from './adoption-builder';
import { getAutomation } from './repo';
import {
  resolveAutomationRuntimeClient,
  type AutomationRuntimeDependencies,
} from './runtime-client-resolver';

type AdoptionData = { taskId: string; projectId: string };
type AdoptionResult = Result<AdoptionData, AutomationAdoptionError>;

const definitionMutex = new KeyedMutex();
const workspaceMutex = new KeyedMutex();
const adoptionPromises = new Map<string, Promise<AdoptionResult>>();

export function adoptRun(
  dependencies: {
    db: AppDb;
    getProjectById(projectId: string): Promise<Project | undefined>;
    runtime: AutomationRuntimeDependencies;
    taskService: Pick<TaskService, 'notifyTaskCreated'>;
  },
  automationId: string,
  runId: string
): Promise<AdoptionResult> {
  const existing = adoptionPromises.get(runId);
  if (existing) return existing;

  const promise = definitionMutex
    .runExclusive(automationId, () => adoptRunSafely(dependencies, automationId, runId))
    .finally(() => adoptionPromises.delete(runId));
  adoptionPromises.set(runId, promise);
  return promise;
}

async function adoptRunSafely(
  dependencies: Parameters<typeof adoptRun>[0],
  automationId: string,
  runId: string
): Promise<AdoptionResult> {
  try {
    return await adoptRunOnce(dependencies, automationId, runId);
  } catch (error) {
    return err(runtimeUnavailable(error));
  }
}

async function adoptRunOnce(
  dependencies: Parameters<typeof adoptRun>[0],
  automationId: string,
  runId: string
): Promise<AdoptionResult> {
  const automation = await getAutomation(dependencies.db, automationId);
  if (!automation) {
    return err({
      type: 'automation-not-found',
      automationId,
      message: 'This automation no longer exists.',
    });
  }
  if (!automation.projectId) {
    return err({
      type: 'no-project-attached',
      automationId,
      message: 'Attach the automation to a project before opening its runs.',
    });
  }
  const projectId = automation.projectId;
  const client = await resolveAutomationRuntimeClient(dependencies.runtime, projectId);
  const runResult = await client.automations.getRun({ automationId, runId });
  const runtimeRun: Result<AutomationRun, AutomationAdoptionError> = !runResult.success
    ? err(runtimeUnavailable(runResult.error))
    : runResult.data.run
      ? ok(runResult.data.run)
      : err({
          type: 'run-not-found',
          runId,
          message: 'This automation run no longer exists.',
        });
  if (!runtimeRun.success) return runtimeRun;

  const existingTask = await findAdoptedTask(dependencies.db, runId);
  if (existingTask) return ok(existingTask);
  if (!isAutomationRunAdoptable(runtimeRun.data)) {
    return err({
      type: 'run-not-adoptable',
      runId,
      message: 'The automation workspace is not ready yet.',
    });
  }
  await upsertRunProjection(dependencies.db, runtimeRun.data);

  const project = await dependencies.getProjectById(projectId);
  if (!project) {
    return err({
      type: 'project-not-found',
      projectId,
      message: 'The selected project no longer exists.',
    });
  }
  if (project.type !== 'local') {
    return err({
      type: 'adoption-unavailable',
      message: 'Remote automation runs cannot be opened as desktop tasks yet.',
    });
  }

  const workspacePath = nativePathFromHost(runtimeRun.data.workspace.path);
  const workspaceKey = computeWorkspaceKey('local', workspacePath);
  return workspaceMutex.runExclusive(workspaceKey, async () => {
    const concurrentAdoption = await findAdoptedTask(dependencies.db, runId);
    if (concurrentAdoption) return ok(concurrentAdoption);

    const [workspaceRow] = await dependencies.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.key, workspaceKey))
      .limit(1);
    const workspaceId = workspaceRow?.id ?? randomUUID();
    const taskId = randomUUID();
    const conversationInsert = conversationForRun(runtimeRun.data, projectId, taskId);
    const taskParams = taskParamsForRun(
      runtimeRun.data,
      projectId,
      taskId,
      workspaceId,
      conversationInsert
    );

    let taskRow!: TaskRow;
    let conversationRow: ConversationRow | undefined;
    let created = false;
    dependencies.db.transaction((tx) => {
      const concurrentTask = tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.automationRunId, runId), isNull(tasks.deletedAt)))
        .limit(1)
        .get();
      if (concurrentTask) {
        taskRow = concurrentTask;
        return;
      }

      const storedWorkspaceConfig = storedWorkspaceConfigForRun(runtimeRun.data, workspaceId);
      if (workspaceRow) {
        tx.update(workspaces)
          .set({
            path: workspacePath,
            config: storedWorkspaceConfig,
            branchName: runtimeRun.data.branchName,
            deletedAt: null,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(workspaces.id, workspaceId))
          .run();
      } else {
        tx.insert(workspaces)
          .values({
            id: workspaceId,
            key: workspaceKey,
            type: 'local',
            kind:
              runtimeRun.data.configSnapshot.workspace.kind === 'worktree'
                ? 'worktree'
                : 'project-root',
            location: 'local',
            path: workspacePath,
            config: storedWorkspaceConfig,
            branchName: runtimeRun.data.branchName,
          })
          .run();
      }

      [taskRow] = tx
        .insert(tasks)
        .values({
          id: taskId,
          projectId,
          name: runtimeRun.data.generatedName,
          status: 'in_progress',
          workspaceId,
          taskBranch: runtimeRun.data.branchName,
          type: 'automation-run',
          automationRunId: runtimeRun.data.id,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          statusChangedAt: sql`CURRENT_TIMESTAMP`,
          lastInteractedAt: sql`CURRENT_TIMESTAMP`,
        })
        .returning()
        .all();
      created = true;
      if (conversationInsert) {
        [conversationRow] = tx.insert(conversations).values(conversationInsert).returning().all();
      }
    });

    const task: Task = mapTaskRowToTask(taskRow, [], {}, automationRunMetaForRun(runtimeRun.data));
    if (created) dependencies.taskService.notifyTaskCreated(task, taskParams);
    if (created && conversationRow) {
      const conversation = mapConversationRowToConversation(conversationRow);
      conversationEvents._emit('conversation:created', conversation);
      conversationWireEvents.emit(undefined, { type: 'created', conversation });
    }
    return ok({ taskId: task.id, projectId: task.projectId });
  });
}

async function findAdoptedTask(
  db: AppDb,
  runId: string
): Promise<{ taskId: string; projectId: string } | null> {
  const [task] = await db
    .select({ taskId: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.automationRunId, runId), isNull(tasks.deletedAt)))
    .limit(1);
  return task ?? null;
}

function runtimeUnavailable(error: unknown): AutomationAdoptionError {
  return {
    type: 'runtime-unavailable',
    message:
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error),
  };
}
