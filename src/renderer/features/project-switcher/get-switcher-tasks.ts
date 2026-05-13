import { sortTasksForSwitcher, type SwitcherTask } from '@shared/project-switcher';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';

export interface ProjectTask {
  projectId: string;
  projectName: string;
  store: TaskStore;
  data: SwitcherTask;
}

/** Returns all non-archived tasks across projects, sorted in switcher order. */
export function getSwitcherTasks(): ProjectTask[] {
  const result: ProjectTask[] = [];
  for (const store of getProjectManagerStore().projects.values()) {
    const mounted = asMounted(store);
    if (!mounted) continue;
    const projectId = mounted.data.id;
    const projectName = store.name ?? projectId;
    const tasks: { store: TaskStore; data: SwitcherTask }[] = [];
    for (const taskStore of mounted.taskManager.tasks.values()) {
      const task = registeredTaskData(taskStore);
      if (!task || task.archivedAt) continue;
      tasks.push({
        store: taskStore,
        data: {
          id: task.id,
          name: task.name,
          status: task.status,
          lastInteractedAt: task.lastInteractedAt ?? task.updatedAt,
        },
      });
    }
    const sorted = sortTasksForSwitcher(tasks.map((t) => t.data));
    const byId = new Map(tasks.map((t) => [t.data.id, t]));
    for (const s of sorted) {
      const entry = byId.get(s.id)!;
      result.push({ projectId, projectName, store: entry.store, data: entry.data });
    }
  }
  return result;
}
