import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { ok } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Contract, ContractImpl } from '@emdash/wire';
import { expose, family, query } from '@emdash/wire/state';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { tasksWireContract } from '@core/features/tasks/api';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import { enqueueDeleteTask } from '@core/features/tasks/node/operations/delete-task-definition';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { TaskListData, TaskStatsData } from '@core/primitives/tasks/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes, matchProject } from '@core/services/app-db/node/pokes';
import { tasks, workspaces } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';
import { createTaskOperations } from './controller';

type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type TasksWireImpl = ContractImpl<ContractDefinitionsOf<typeof tasksWireContract>>;

export type TasksWireController = {
  impl: TasksWireImpl;
  dispose(): Promise<void>;
};

export function createTasksWireController(options: {
  db: AppDb;
  operations: OperationsEngine;
  runtimes: RuntimeBroker;
  service: TaskService;
  telemetry: TelemetryService;
  workspaceIdentity: WorkspaceIdentityService;
}): TasksWireController {
  const { operations } = options;
  const taskOperations = createTaskOperations(options);
  const taskListFamily = family(
    ({ projectId }: { projectId: string }, scope) =>
      query<TaskListData>({
        fetch: async () => ({ tasks: (await taskOperations.getTasks(projectId)).map(toTaskRow) }),
        pokes: [
          appDbPokes.tasks.subscription(matchProject(projectId)),
          appDbPokes.conversations.subscription(matchProject(projectId)),
        ],
        scope,
      }),
    { name: 'task-list' }
  );
  const taskStatsFamily = family(
    ({ projectId }: { projectId: string }, scope) =>
      query<TaskStatsData>({
        fetch: async () => loadTaskStats(options.db, projectId),
        pokes: [appDbPokes.workspaces.subscription(matchProject(projectId))],
        scope,
      }),
    { name: 'task-stats' }
  );
  const taskListProvider = expose(
    tasksWireContract.taskList,
    {
      list: (key: { projectId: string }, scope: Scope) => {
        scope.add(taskListFamily.retain(key));
        return taskListFamily(key);
      },
    },
    {
      mutations: {
        async rename(context) {
          const result = await options.service.renameTask(
            context.key.projectId,
            context.input.taskId,
            context.input.newName
          );
          if (!result.success) return result;
          await context.observed(
            'list',
            taskListFamily(context.key).refresh({ mutationIds: [context.mutationId] })
          );
          return result;
        },
        async setStatus(context) {
          await options.service.updateTaskStatus(
            context.input.taskId,
            context.input.status,
            options.telemetry
          );
          await context.observed(
            'list',
            taskListFamily(context.key).refresh({ mutationIds: [context.mutationId] })
          );
          return ok<void>();
        },
        async setPinned(context) {
          await options.service.setTaskPinned(context.input.taskId, context.input.isPinned);
          await context.observed(
            'list',
            taskListFamily(context.key).refresh({ mutationIds: [context.mutationId] })
          );
          return ok<void>();
        },
        async setLinkedIssue(context) {
          await options.service.updateLinkedIssue(
            context.input.taskId,
            context.input.issue,
            options.telemetry
          );
          await context.observed(
            'list',
            taskListFamily(context.key).refresh({ mutationIds: [context.mutationId] })
          );
          return ok<void>();
        },
        async convertAutomation(context) {
          const task = await options.service.convertAutomationTask(context.input.taskId);
          await context.observed(
            'list',
            taskListFamily(context.key).refresh({ mutationIds: [context.mutationId] })
          );
          return ok(task);
        },
        async archive(context) {
          await options.service.archiveTask(
            context.key.projectId,
            context.input.taskId,
            options.telemetry
          );
          await context.observed(
            'list',
            taskListFamily(context.key).refresh({ mutationIds: [context.mutationId] })
          );
          return ok<void>();
        },
        async restore(context) {
          await options.service.restoreTask(context.input.taskId);
          await context.observed(
            'list',
            taskListFamily(context.key).refresh({ mutationIds: [context.mutationId] })
          );
          return ok<void>();
        },
      },
    }
  );
  const taskStatsProvider = expose(tasksWireContract.taskStats, {
    stats: (key, scope: Scope) => {
      scope.add(taskStatsFamily.retain(key));
      return taskStatsFamily(key);
    },
  });
  return {
    impl: {
      createTask: (input) => taskOperations.createTask(input),
      getDeletePreflight: ({ projectId, taskIds }) =>
        taskOperations.getDeletePreflight(projectId, taskIds),
      deleteTask: ({ projectId, taskId, options }) =>
        taskOperations.deleteTask(projectId, taskId, options),
      deleteTasks: ({ projectId, taskIds, options }) =>
        taskOperations.deleteTasks(projectId, taskIds, options),
      getProjectWorkspaces: ({ projectId }) => taskOperations.getProjectWorkspaces(projectId),
      teardownTask: ({ projectId, taskId }) => taskOperations.teardownTask(projectId, taskId),
      generateTaskName: (input) => taskOperations.generateTaskName(input),
      taskList: taskListProvider,
      taskStats: taskStatsProvider,
      delete: (input) => enqueueDeleteTask(operations, input),
    },
    async dispose() {
      await taskListProvider.dispose();
      await taskStatsProvider.dispose();
      await taskListFamily.dispose();
      await taskStatsFamily.dispose();
    },
  };
}

function toTaskRow(
  task: Awaited<ReturnType<TaskService['getTasks']>>[number]
): TaskListData['tasks'][number] {
  const { prs: _prs, workspaceGit: _workspaceGit, ...row } = task;
  return row;
}

async function loadTaskStats(db: AppDb, projectId: string): Promise<TaskStatsData> {
  const taskRows = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
  const workspaceIds = taskRows.map((row) => row.workspaceId).filter((id): id is string => !!id);
  if (workspaceIds.length === 0) return { byWorkspaceId: {} };
  const rows = await db
    .select({
      id: workspaces.id,
      linesAdded: workspaces.linesAdded,
      linesDeleted: workspaces.linesDeleted,
    })
    .from(workspaces)
    .where(and(inArray(workspaces.id, workspaceIds), isNull(workspaces.deletedAt)));
  return {
    byWorkspaceId: Object.fromEntries(
      rows.flatMap((row) =>
        row.linesAdded == null
          ? []
          : [[row.id, { linesAdded: row.linesAdded, linesDeleted: row.linesDeleted ?? 0 }]]
      )
    ),
  };
}
