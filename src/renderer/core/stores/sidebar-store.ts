import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { MountedProject, ProjectStore, UnmountedProject, UnregisteredProject } from './project';
import { projectManagerStore } from './project-manager';
import type { TaskStore } from './task';

const PROJECT_ORDER_KEY = 'sidebarProjectOrder';
const TASK_ORDER_BY_PROJECT_KEY = 'sidebarTaskOrderByProject';
const PINNED_TASKS_KEY = 'emdash-pinned-tasks';

class SidebarStore {
  projectOrder: string[] = [];
  taskOrderByProject: Record<string, string[]> = {};
  forceOpenIds = observable.set<string>();
  pinnedTaskIds: string[] = [];

  constructor() {
    makeAutoObservable(this, { forceOpenIds: false });

    try {
      const stored = localStorage.getItem(PROJECT_ORDER_KEY);
      if (stored) this.projectOrder = JSON.parse(stored) as string[];
    } catch {}

    try {
      const stored = localStorage.getItem(PINNED_TASKS_KEY);
      if (stored) this.pinnedTaskIds = JSON.parse(stored) as string[];
    } catch {}

    try {
      const stored = localStorage.getItem(TASK_ORDER_BY_PROJECT_KEY);
      if (stored) this.taskOrderByProject = JSON.parse(stored) as Record<string, string[]>;
    } catch {}

    // Auto-expand a project when its task count goes from 0 to >0.
    const prevTaskCounts = new Map<string, number>();
    reaction(
      () => {
        const counts: [string, number][] = [];
        for (const [id, project] of projectManagerStore.projects) {
          if (project.state === 'mounted' && project.taskManager) {
            counts.push([id, project.taskManager.tasks.size]);
          }
        }
        return counts;
      },
      (counts) => {
        runInAction(() => {
          for (const [id, count] of counts) {
            const prev = prevTaskCounts.get(id) ?? 0;
            if (prev === 0 && count > 0) {
              this.forceOpenIds.add(id);
            }
            prevTaskCounts.set(id, count);
          }
        });
      }
    );
  }

  get orderedProjects(): ProjectStore[] {
    const all = Array.from(projectManagerStore.projects.values());

    const unregistered = all.filter((p): p is UnregisteredProject => p.state === 'unregistered');
    const real = all.filter(
      (p): p is UnmountedProject | MountedProject => p.state !== 'unregistered'
    );

    const sorted = [...real].sort((a, b) => {
      const ai = this.projectOrder.indexOf(a.data.id);
      const bi = this.projectOrder.indexOf(b.data.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    return [...unregistered, ...sorted];
  }

  get isEmpty(): boolean {
    return projectManagerStore.projects.size === 0;
  }

  setProjectOrder(ids: string[]): void {
    this.projectOrder = ids;
    try {
      localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(ids));
    } catch {}
  }

  mergeTaskOrder(projectId: string, tasks: TaskStore[]): TaskStore[] {
    const stored = this.taskOrderByProject[projectId] ?? [];
    const byId = new Map(tasks.map((t) => [t.data.id, t] as const));
    const seen = new Set<string>();
    const result: TaskStore[] = [];
    for (const id of stored) {
      const t = byId.get(id);
      if (t) {
        result.push(t);
        seen.add(id);
      }
    }
    for (const t of tasks) {
      if (!seen.has(t.data.id)) result.push(t);
    }
    return result;
  }

  setTaskOrder(projectId: string, orderedIds: string[]): void {
    this.taskOrderByProject = { ...this.taskOrderByProject, [projectId]: orderedIds };
    try {
      localStorage.setItem(TASK_ORDER_BY_PROJECT_KEY, JSON.stringify(this.taskOrderByProject));
    } catch {}
  }

  pinTask(taskId: string): void {
    if (!this.pinnedTaskIds.includes(taskId)) {
      this.pinnedTaskIds.push(taskId);
      this._persistPinnedTasks();
    }
  }

  unpinTask(taskId: string): void {
    this.pinnedTaskIds = this.pinnedTaskIds.filter((id) => id !== taskId);
    this._persistPinnedTasks();
  }

  togglePinTask(taskId: string): void {
    if (this.pinnedTaskIds.includes(taskId)) {
      this.unpinTask(taskId);
    } else {
      this.pinTask(taskId);
    }
  }

  clearForceOpen(projectId: string): void {
    this.forceOpenIds.delete(projectId);
  }

  private _persistPinnedTasks(): void {
    try {
      localStorage.setItem(PINNED_TASKS_KEY, JSON.stringify(this.pinnedTaskIds));
    } catch {}
  }
}

export const sidebarStore = new SidebarStore();
