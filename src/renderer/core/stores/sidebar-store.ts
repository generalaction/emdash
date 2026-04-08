import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { LocalProject, SshProject } from '@shared/projects';
import type { SidebarSnapshot } from '@shared/view-state';
import { ProjectStore, UnregisteredProject } from './project';
import type { ProjectManagerStore } from './project-manager';
import type { Snapshottable } from './snapshottable';
import type { TaskStore } from './task';

const PROJECT_ORDER_KEY = 'sidebarProjectOrder';
const TASK_ORDER_BY_PROJECT_KEY = 'sidebarTaskOrderByProject';
const PINNED_TASKS_KEY = 'emdash-pinned-tasks';

export type SidebarRow =
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string };

export class SidebarStore implements Snapshottable<SidebarSnapshot> {
  projectOrder: string[] = [];
  taskOrderByProject: Record<string, string[]> = {};
  expandedProjectIds = observable.set<string>();
  pinnedTaskIds: string[] = [];

  constructor(private readonly projectManager: ProjectManagerStore) {
    makeAutoObservable(this, {
      expandedProjectIds: false,
      sidebarRows: computed,
    });

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
        for (const [id, project] of this.projectManager.projects) {
          if (project.mountedProject) {
            counts.push([id, project.mountedProject.taskManager.tasks.size]);
          }
        }
        return counts;
      },
      (counts) => {
        runInAction(() => {
          for (const [id, count] of counts) {
            const prev = prevTaskCounts.get(id) ?? 0;
            if (prev === 0 && count > 0) {
              this.ensureProjectExpanded(id);
            }
            prevTaskCounts.set(id, count);
          }
        });
      }
    );
  }

  get orderedProjects(): ProjectStore[] {
    const all = Array.from(this.projectManager.projects.values());

    const unregistered = all.filter((p): p is UnregisteredProject => p.state === 'unregistered');
    const real = all.filter(
      (p): p is ProjectStore & { data: LocalProject | SshProject } => p.state !== 'unregistered'
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

  get sidebarRows(): SidebarRow[] {
    const rows: SidebarRow[] = [];
    for (const project of this.orderedProjects) {
      const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
      rows.push({ kind: 'project', projectId });
      if (this.expandedProjectIds.has(projectId) && project.mountedProject) {
        const tasks = Array.from(project.mountedProject.taskManager.tasks.values()).filter(
          (t) => t.state === 'unregistered' || !('archivedAt' in t.data && t.data.archivedAt)
        );
        const ordered = this.mergeTaskOrder(projectId, tasks);
        for (const task of ordered) {
          rows.push({ kind: 'task', projectId, taskId: task.data.id });
        }
      }
    }
    return rows;
  }

  get isEmpty(): boolean {
    return this.projectManager.projects.size === 0;
  }

  get snapshot(): SidebarSnapshot {
    return {
      expandedProjectIds: [...this.expandedProjectIds],
    };
  }

  restoreSnapshot(snapshot: Partial<SidebarSnapshot>): void {
    if (snapshot.expandedProjectIds) {
      this.expandedProjectIds.replace(snapshot.expandedProjectIds);
    }
  }

  /** Called on first load when no snapshot exists — expand all known projects. */
  expandAllProjects(): void {
    for (const project of this.orderedProjects) {
      const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
      this.expandedProjectIds.add(projectId);
    }
  }

  toggleProjectExpanded(projectId: string): void {
    if (this.expandedProjectIds.has(projectId)) {
      this.expandedProjectIds.delete(projectId);
    } else {
      this.expandedProjectIds.add(projectId);
    }
  }

  ensureProjectExpanded(projectId: string): void {
    this.expandedProjectIds.add(projectId);
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

  private _persistPinnedTasks(): void {
    try {
      localStorage.setItem(PINNED_TASKS_KEY, JSON.stringify(this.pinnedTaskIds));
    } catch {}
  }
}
