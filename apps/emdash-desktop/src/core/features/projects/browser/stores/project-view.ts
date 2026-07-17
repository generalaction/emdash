import { makeAutoObservable } from 'mobx';
import type { ProjectViewState } from '@core/features/projects/contributions/mementos';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';
import type { MementoHandle } from '@core/primitives/mementos/browser';

export type ProjectView = 'tasks' | 'pull-request' | 'workspaces' | 'settings';

export class ProjectViewStore {
  readonly taskView: TaskViewStore;

  constructor(private readonly handle: MementoHandle<ProjectViewState>) {
    this.taskView = new TaskViewStore(handle);
    makeAutoObservable<ProjectViewStore, 'handle'>(this, { handle: false, taskView: false });
  }

  get activeView(): ProjectView {
    return this.handle.value.activeView;
  }

  get selectedIssueProvider(): IssueProviderType | null {
    return (this.handle.value.selectedIssueProvider as IssueProviderType | undefined) ?? null;
  }

  setProjectView(view: ProjectView) {
    this.handle.update((current) => ({ ...current, activeView: view }));
  }

  setSelectedIssueProvider(provider: IssueProviderType | null) {
    this.handle.update((current) => ({
      ...current,
      selectedIssueProvider: provider ?? undefined,
    }));
  }
}

class TaskViewStore {
  searchQuery: string = '';
  selectedIds: Set<string> = new Set();
  lastSelectedId: string | null = null;

  constructor(private readonly handle: MementoHandle<ProjectViewState>) {
    makeAutoObservable<TaskViewStore, 'handle'>(this, { handle: false });
  }

  get tab(): 'active' | 'archived' {
    return this.handle.value.taskViewTab;
  }

  setTab(tab: 'active' | 'archived') {
    this.handle.update((current) => ({ ...current, taskViewTab: tab }));
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
