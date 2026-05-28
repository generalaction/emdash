import type { Task, TaskSidebarGroup } from '@shared/tasks';
import { taskSidebarGroupForKind } from '@shared/tasks';
import type { TaskStore } from './task-store';
import { isRegistered, unregisteredTaskData } from './task-store';

export function taskSidebarGroupForTask(task: Pick<Task, 'kind'>): TaskSidebarGroup {
  return taskSidebarGroupForKind(task.kind);
}

export function taskSidebarGroupForStore(task: TaskStore): TaskSidebarGroup {
  if (isRegistered(task)) {
    return taskSidebarGroupForTask(task.data);
  }
  const unregistered = unregisteredTaskData(task);
  return taskSidebarGroupForKind(unregistered?.kind ?? 'task');
}

export function partitionTasksBySidebarGroup(
  tasks: TaskStore[]
): Record<TaskSidebarGroup, TaskStore[]> {
  const groups: Record<TaskSidebarGroup, TaskStore[]> = { tasks: [], chats: [] };
  for (const task of tasks) {
    groups[taskSidebarGroupForStore(task)].push(task);
  }
  return groups;
}
