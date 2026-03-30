import { makeAutoObservable } from 'mobx';
import type { ProjectViewSnapshot } from '@shared/view-state';
import type { Snapshottable } from './snapshottable';

export type ProjectView = 'tasks' | 'pull-request' | 'settings';

export class ProjectViewStore implements Snapshottable<ProjectViewSnapshot> {
  activeView: ProjectView = 'tasks';
  taskView: TaskViewStore = new TaskViewStore();

  constructor() {
    makeAutoObservable(this);
  }

  setProjectView(view: ProjectView) {
    this.activeView = view;
  }

  get snapshot(): ProjectViewSnapshot {
    return {
      activeView: this.activeView,
      taskViewTab: this.taskView.tab,
    };
  }

  restoreSnapshot(snapshot: Partial<ProjectViewSnapshot>): void {
    if (snapshot.activeView) this.activeView = snapshot.activeView as ProjectView;
    if (snapshot.taskViewTab) this.taskView.setTab(snapshot.taskViewTab);
  }
}

class TaskViewStore {
  tab: 'active' | 'archived' = 'active';
  searchQuery: string = '';
  selectedIds: Set<string> = new Set();

  constructor() {
    makeAutoObservable(this);
  }

  setTab(tab: 'active' | 'archived') {
    this.tab = tab;
  }

  setSearchQuery(query: string) {
    this.searchQuery = query;
  }

  setSelectedIds(ids: Set<string>) {
    this.selectedIds = ids;
  }

  toggleSelect(id: string) {
    this.selectedIds.has(id) ? this.selectedIds.delete(id) : this.selectedIds.add(id);
  }
}
