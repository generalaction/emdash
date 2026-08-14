import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import {
  asMounted,
  getProjectManagerStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getSearchClient } from '@core/features/search/api/client';
import {
  getTaskManagerStore,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import {
  createTaskPaletteProviderDef,
  type TaskPaletteMatch,
} from '@core/features/tasks/browser/palette/task-palette-provider';
import { TaskPaletteRow } from '@core/features/tasks/browser/palette/task-palette-row';
import {
  createTaskPaletteSource,
  type TaskPaletteNotificationTask,
} from '@core/features/tasks/browser/palette/task-palette-source';
import type { PaletteProviderDef } from '@core/primitives/palette/api';
import { isRegistered, registeredTaskData } from '@core/primitives/task-state/browser/task-state';

function listNotificationTasks(): TaskPaletteNotificationTask[] {
  const tasks: TaskPaletteNotificationTask[] = [];

  for (const projectStore of getProjectManagerStore().projects.values()) {
    const project = asMounted(projectStore);
    if (!project) continue;
    const taskManager = getTaskManagerStore(project.data.id);
    if (!taskManager) continue;

    for (const [taskId, taskStore] of taskManager.tasks) {
      if (!isRegistered(taskStore)) continue;
      const conversations = conversationRegistry.get(taskId);
      if (!conversations) continue;

      tasks.push({
        projectId: project.data.id,
        taskId,
        title: taskStore.data.name,
        status: conversations.taskStatus,
        conversations: [...conversations.conversations.values()].map((conversation) => ({
          id: conversation.data.id,
          title: conversation.data.title ?? '',
          seen: conversation.seen,
          indicatorStatus: conversation.indicatorStatus,
        })),
      });
    }
  }

  return tasks;
}

const taskPaletteSource = createTaskPaletteSource({
  getSearchClient,
  listNotificationTasks,
  taskLastInteractedAt: (projectId, taskId) => {
    const taskStore = getTaskStore(projectId, taskId);
    return taskStore ? registeredTaskData(taskStore)?.lastInteractedAt : undefined;
  },
});

const typedTaskPaletteProviderDef = createTaskPaletteProviderDef({
  source: taskPaletteSource,
  render: TaskPaletteRow,
});

export const taskPaletteProviderDef: PaletteProviderDef = {
  ...typedTaskPaletteProviderDef,
  render: ({ match, value, onSelect }) => (
    <TaskPaletteRow match={match as TaskPaletteMatch} value={value} onSelect={onSelect} />
  ),
};

export const taskPaletteProviderDefs = [taskPaletteProviderDef] as const;
