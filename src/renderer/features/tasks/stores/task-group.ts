import type { Task, TaskSidebarGroup } from '@shared/tasks';
import { taskSidebarGroupForKind } from '@shared/tasks';
import type { TaskStore } from './task-store';
import { isRegistered } from './task-store';

export function taskSidebarGroupForTask(task: Pick<Task, 'kind'>): TaskSidebarGroup {
  return taskSidebarGroupForKind(task.kind);
}

export function taskSidebarGroupForStore(task: TaskStore): TaskSidebarGroup | null {
  if (!isRegistered(task)) return null;
  return taskSidebarGroupForTask(task.data);
}

export function partitionTasksBySidebarGroup(
  tasks: TaskStore[]
): Record<TaskSidebarGroup, TaskStore[]> {
  const groups: Record<TaskSidebarGroup, TaskStore[]> = { tasks: [], chats: [] };
  for (const task of tasks) {
    const group = taskSidebarGroupForStore(task);
    if (group) groups[group].push(task);
  }
  return groups;
}
