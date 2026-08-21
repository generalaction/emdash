import { randomUUID } from 'node:crypto';
import { hostRefEquals, hostRefKey } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { err, ok, type Result } from '@emdash/shared';
import { KeyedMutex } from '@emdash/shared/concurrency';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isAutomationRunAdoptable } from '@core/features/automations/api/automation-run';
import { upsertRunProjection } from '@core/features/automations/api/node/run-projection';
import { conversationWireEvents } from '@core/features/conversations/api/node';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import { mapTaskRowToTask } from '@core/features/tasks/api/node/utils/utils';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { workspaceHostStorage } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { AutomationAdoptionError } from '@core/primitives/automations/api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { projectHostRef, type Project } from '@core/primitives/projects/api';
import type { Task } from '@core/primitives/tasks/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { tasks, type ConversationRow, type TaskRow } from '@core/services/app-db/node/schema';
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
  const workspaceHost = runtimeRun.data.workspace.host;
  if (!hostRefEquals(workspaceHost, projectHostRef(project))) {
    return err({
      type: 'adoption-unavailable',
      message: 'The automation workspace belongs to a different runtime host.',
    });
  }

  const workspacePath = nativePathFromHost(runtimeRun.data.workspace.path);
  const workspaceStorage = workspaceHostStorage(workspaceHost);
  const workspaceMutexKey = `${hostRefKey(workspaceHost)}:${workspacePath}`;
  return workspaceMutex.runExclusive(workspaceMutexKey, async () => {
    const concurrentAdoption = await findAdoptedTask(dependencies.db, runId);
    if (concurrentAdoption) return ok(concurrentAdoption);

    const registry = createWorkspaceRegistry(dependencies.db);
    const resolvedWorkspace = await client.workspaceRegistry.createWorkspace({
      workspaceId: runId,
      path: workspacePath,
    });
    if (!resolvedWorkspace.success) {
      return err({
        type: 'adoption-unavailable',
        message: `Could not resolve the Host workspace (${resolvedWorkspace.error.type}).`,
      });
    }
    const workspaceId = resolvedWorkspace.data.id;
    const storedWorkspaceConfig = storedWorkspaceConfigForRun(runtimeRun.data, workspaceId);
    const claimed = registry.claim({
      host: {
        location: workspaceStorage.location,
        sshConnectionId: workspaceStorage.sshConnectionId,
      },
      record: resolvedWorkspace.data,
      config: storedWorkspaceConfig,
    });
    if (!claimed.success) {
      return err({
        type: 'adoption-unavailable',
        message: `Could not claim the Host workspace (${claimed.error.type}).`,
      });
    }
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
        // Record creation happened host-side when the run's session started (spec §10.5);
        // adoption only gives the mirror row its task link. Convergence may have mirrored
        // the record already — annotate then; otherwise seed the mirror row directly.
        const conversationRegistry = createConversationRegistry(dependencies.db);
        if (conversationRegistry.getLive(conversationInsert.id, tx)) {
          conversationRegistry.annotate(
            conversationInsert.id,
            { projectId, taskId, isInitialConversation: true },
            tx
          );
          conversationRow = conversationRegistry.getLive(conversationInsert.id, tx);
        } else {
          conversationRow = conversationRegistry.register(
            {
              ...conversationInsert,
              cwd: workspacePath,
              workspacePath,
              idRegime: conversationInsert.type === 'acp' ? 'provider-minted' : 'emdash-chosen',
              location: workspaceStorage.location,
              sshConnectionId: workspaceStorage.sshConnectionId,
            },
            tx
          );
        }
      }
    });

    const task: Task = mapTaskRowToTask(taskRow, [], {}, automationRunMetaForRun(runtimeRun.data));
    if (created) dependencies.taskService.notifyTaskCreated(task, taskParams);
    if (created && conversationRow) {
      const conversation = mapConversationRowToConversation(conversationRow);
      if (conversation !== null) {
        conversationEvents._emit('conversation:created', conversation);
        conversationWireEvents.emit(undefined, { type: 'created', conversation });
        appDbPokes.conversations.poke({ projectId: task.projectId, taskId: task.id });
      }
    }
    if (created) appDbPokes.tasks.poke({ projectId: task.projectId, taskId: task.id });
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
