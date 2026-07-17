import { randomUUID } from 'node:crypto';
import { KeyedMutex } from '@emdash/core/primitives/concurrency/api';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { conversationWireEvents } from '@core/features/conversations/node';
import { isAutomationRunAdoptable } from '@core/primitives/automations/api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { Task } from '@core/primitives/tasks/api';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { taskService } from '@main/core/tasks/task-service';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { computeWorkspaceKey } from '@main/core/workspaces/workspace-key';
import { db } from '@main/db/client';
import {
  conversations,
  tasks,
  workspaces,
  type ConversationRow,
  type TaskRow,
} from '@main/db/schema';
import {
  automationRunMetaForRun,
  conversationForRun,
  storedWorkspaceConfigForRun,
  taskParamsForRun,
} from './adoption-builder';
import { getAutomation } from './repo';
import { upsertRunProjection } from './run-projection';
import { resolveAutomationRuntime } from './runtime-client-resolver';

const definitionMutex = new KeyedMutex();
const workspaceMutex = new KeyedMutex();
const adoptionPromises = new Map<string, Promise<{ taskId: string; projectId: string }>>();

export function adoptRun(
  automationId: string,
  runId: string
): Promise<{ taskId: string; projectId: string }> {
  const existing = adoptionPromises.get(runId);
  if (existing) return existing;

  const promise = definitionMutex
    .runExclusive(automationId, () => adoptRunOnce(automationId, runId))
    .finally(() => adoptionPromises.delete(runId));
  adoptionPromises.set(runId, promise);
  return promise;
}

async function adoptRunOnce(
  automationId: string,
  runId: string
): Promise<{ taskId: string; projectId: string }> {
  const automation = await getAutomation(automationId);
  if (!automation) throw new Error('automation_not_found');
  if (!automation.projectId) throw new Error('no_project_attached');
  const projectId = automation.projectId;
  const target = await resolveAutomationRuntime(projectId);
  const runResult = await target.client.getRun({ automationId, runId });
  if (!runResult.success) throw new Error(runResult.error.message);
  const runtimeRun = runResult.data.run;
  if (!runtimeRun) throw new Error('automation_run_not_found');

  const existingTask = await findAdoptedTask(runId);
  if (existingTask) return existingTask;
  if (!isAutomationRunAdoptable(runtimeRun)) {
    throw new Error('automation_run_workspace_not_ready');
  }
  await upsertRunProjection(runtimeRun);

  const project = await getProjectById(projectId);
  if (!project) throw new Error('project_not_found');
  if (project.type !== 'local') {
    throw new Error('The remote automation runtime cannot be reached.');
  }

  const workspacePath = nativePathFromHost(runtimeRun.workspace.path);
  const workspaceKey = computeWorkspaceKey('local', workspacePath);
  return workspaceMutex.runExclusive(workspaceKey, async () => {
    const concurrentAdoption = await findAdoptedTask(runId);
    if (concurrentAdoption) return concurrentAdoption;

    const [workspaceRow] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.key, workspaceKey))
      .limit(1);
    const workspaceId = workspaceRow?.id ?? randomUUID();
    const taskId = randomUUID();
    const conversationInsert = conversationForRun(runtimeRun, projectId, taskId);
    const taskParams = taskParamsForRun(
      runtimeRun,
      projectId,
      taskId,
      workspaceId,
      conversationInsert
    );

    let taskRow!: TaskRow;
    let conversationRow: ConversationRow | undefined;
    let created = false;
    db.transaction((tx) => {
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

      const storedWorkspaceConfig = storedWorkspaceConfigForRun(runtimeRun, workspaceId);
      if (workspaceRow) {
        tx.update(workspaces)
          .set({
            path: workspacePath,
            config: storedWorkspaceConfig,
            branchName: runtimeRun.branchName,
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
              runtimeRun.configSnapshot.workspace.kind === 'worktree' ? 'worktree' : 'project-root',
            location: 'local',
            path: workspacePath,
            config: storedWorkspaceConfig,
            branchName: runtimeRun.branchName,
          })
          .run();
      }

      [taskRow] = tx
        .insert(tasks)
        .values({
          id: taskId,
          projectId,
          name: runtimeRun.generatedName,
          status: 'in_progress',
          workspaceId,
          taskBranch: runtimeRun.branchName,
          type: 'automation-run',
          automationRunId: runtimeRun.id,
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

    const task: Task = mapTaskRowToTask(taskRow, [], {}, automationRunMetaForRun(runtimeRun));
    if (created) taskService.notifyTaskCreated(task, taskParams);
    if (created && conversationRow) {
      const conversation = mapConversationRowToConversation(conversationRow);
      conversationEvents._emit('conversation:created', conversation);
      conversationWireEvents.emit(undefined, { type: 'created', conversation });
    }
    return { taskId: task.id, projectId: task.projectId };
  });
}

async function findAdoptedTask(
  runId: string
): Promise<{ taskId: string; projectId: string } | null> {
  const [task] = await db
    .select({ taskId: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.automationRunId, runId), isNull(tasks.deletedAt)))
    .limit(1);
  return task ?? null;
}
