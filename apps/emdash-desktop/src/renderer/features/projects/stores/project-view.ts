import { makeAutoObservable } from 'mobx';
import type {
  TaskChangesFilterValue,
  TaskPrFilterValue,
  TaskSortField,
} from '@renderer/features/projects/components/task-view/task-filters';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import type { AgentStatus } from '@shared/core/agents/agentEvents';
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
  sortBy: TaskSortField = 'newest';
  agentFilter: Set<AgentStatus> = new Set();
  prFilter: Set<TaskPrFilterValue> = new Set();
  changesFilter: Set<TaskChangesFilterValue> = new Set();
  selectedIds: Set<string> = new Set();
  lastSelectedId: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setTab(tab: 'active' | 'archived') {
    if (this.tab === tab) return;
    this.tab = tab;
    this.clearSelection();
  }

  setSearchQuery(query: string) {
    if (this.searchQuery === query) return;
    this.searchQuery = query;
    this.clearSelection();
  }

  setSortBy(sortBy: TaskSortField) {
    this.sortBy = sortBy;
  }

  toggleAgentFilter(value: AgentStatus) {
    if (this.agentFilter.has(value)) this.agentFilter.delete(value);
    else this.agentFilter.add(value);
    this.clearSelection();
  }

  togglePrFilter(value: TaskPrFilterValue) {
    if (this.prFilter.has(value)) this.prFilter.delete(value);
    else this.prFilter.add(value);
    this.clearSelection();
  }

  toggleChangesFilter(value: TaskChangesFilterValue) {
    if (this.changesFilter.has(value)) this.changesFilter.delete(value);
    else this.changesFilter.add(value);
    this.clearSelection();
  }

  get hasActiveFilters(): boolean {
    return this.agentFilter.size > 0 || this.prFilter.size > 0 || this.changesFilter.size > 0;
  }

  clearFilters() {
    this.agentFilter = new Set();
    this.prFilter = new Set();
    this.changesFilter = new Set();
    this.clearSelection();
  }

  setSelectedIds(ids: Set<string>) {
    this.selectedIds = ids;
    this.lastSelectedId = null;
  }

  private clearSelection() {
    this.selectedIds = new Set();
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
