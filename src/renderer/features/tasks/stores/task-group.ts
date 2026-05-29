import type { TaskSidebarGroup } from '@shared/tasks';
import { TASK_SIDEBAR_GROUP, taskSidebarGroupForKind } from '@shared/tasks';
import { taskKindForStore, type TaskStore } from './task-store';

export function taskSidebarGroupForStore(task: TaskStore): TaskSidebarGroup {
  return taskSidebarGroupForKind(taskKindForStore(task));
}

export function partitionTasksBySidebarGroup(
  tasks: TaskStore[]
): Record<TaskSidebarGroup, TaskStore[]> {
  const groups: Record<TaskSidebarGroup, TaskStore[]> = {
    [TASK_SIDEBAR_GROUP.Tasks]: [],
    [TASK_SIDEBAR_GROUP.Chats]: [],
  };
  for (const task of tasks) {
    groups[taskSidebarGroupForStore(task)].push(task);
  }
  return groups;
}
