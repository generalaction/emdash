import { makeAutoObservable } from 'mobx';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import type { IssueProviderType } from '@shared/issue-providers';
import type { ProjectViewSnapshot } from '@shared/view-state';

export type ProjectView = 'tasks' | 'pull-request' | 'settings';

export class ProjectViewStore implements Snapshottable<ProjectViewSnapshot> {
  activeView: ProjectView = 'tasks';
  taskView: TaskViewStore = new TaskViewStore();
  selectedIssueProvider: IssueProviderType | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setProjectView(view: ProjectView) {
    this.activeView = view;
  }

  setSelectedIssueProvider(provider: IssueProviderType | null) {
    this.selectedIssueProvider = provider;
  }

  get snapshot(): ProjectViewSnapshot {
    return {
      activeView: this.activeView,
      taskViewTab: this.taskView.tab,
      selectedIssueProvider: this.selectedIssueProvider ?? undefined,
    };
  }

  restoreSnapshot(snapshot: Partial<ProjectViewSnapshot>): void {
    if (snapshot.activeView) this.activeView = snapshot.activeView as ProjectView;
    if (snapshot.taskViewTab) this.taskView.setTab(snapshot.taskViewTab);
    if (snapshot.selectedIssueProvider)
      this.selectedIssueProvider = snapshot.selectedIssueProvider as IssueProviderType;
  }
}

class TaskViewStore {
  tab: 'active' | 'archived' = 'active';
  searchQuery: string = '';
  selectedIds: Set<string> = new Set();
  lastSelectedId: string | null = null;

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
    this.lastSelectedId = null;
  }

  toggleSelect(id: string) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.lastSelectedId = id;
  }

  selectRange(orderedIds: string[], toId: string) {
    const anchor = this.lastSelectedId;
    if (!anchor || anchor === toId) {
      this.toggleSelect(toId);
      return;
    }
    const fromIndex = orderedIds.indexOf(anchor);
    const toIndex = orderedIds.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) {
      this.toggleSelect(toId);
      return;
    }
    const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    this.selectedIds = new Set(orderedIds.slice(start, end + 1));
  }
}
