import { useObserver } from 'mobx-react-lite';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task-store';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { sortTasksForSwitcher, type SwitcherTask } from './sort-switcher-tasks';

export interface ProjectTask {
  projectId: string;
  projectName: string;
  store: TaskStore;
  data: SwitcherTask;
}

export interface ProjectGroup {
  id: string;
  name: string;
  tasks: ProjectTask[];
}

function getAllTasks(): ProjectTask[] {
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

export function useProjectSwitcher() {
  const { navigate } = useNavigate();

  const currentTaskId = useObserver(() => {
    const nav = appState.navigation;
    const navParams = nav.viewParamsStore['task'] as { taskId?: string } | undefined;
    return nav.currentViewId === 'task' ? navParams?.taskId : undefined;
  });

  const projects = useObserver((): ProjectGroup[] => {
    const allTasks = getAllTasks();
    const grouped = new Map<string, ProjectGroup>();
    for (const task of allTasks) {
      let group = grouped.get(task.projectId);
      if (!group) {
        group = { id: task.projectId, name: task.projectName, tasks: [] };
        grouped.set(task.projectId, group);
      }
      group.tasks.push(task);
    }
    // Move current task to end within its group
    for (const group of grouped.values()) {
      const idx = group.tasks.findIndex((t) => t.data.id === currentTaskId);
      if (idx !== -1) {
        const [current] = group.tasks.splice(idx, 1);
        group.tasks.push(current);
      }
    }
    return [...grouped.values()].filter((g) => g.tasks.length > 0);
  });

  const switchTask = (direction: 1 | -1) => {
    const allTasks = getAllTasks();
    if (allTasks.length === 0) return;
    const currentIdx = allTasks.findIndex((t) => t.data.id === currentTaskId);
    const nextIdx =
      currentIdx === -1 ? 0 : (currentIdx + direction + allTasks.length) % allTasks.length;
    const target = allTasks[nextIdx];
    navigate('task', { projectId: target.projectId, taskId: target.data.id });
  };

  return {
    projects,
    currentTaskId,
    switchToNext: () => switchTask(1),
    switchToPrev: () => switchTask(-1),
  };
}
