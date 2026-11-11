import { computed, makeAutoObservable, observable } from 'mobx';
import { type ProjectStore } from '@core/features/projects/api/browser/stores/project';
import type { ProjectManagerStore } from '@core/features/projects/api/browser/stores/project-manager';
import { asAvailableProject } from '@core/features/projects/api/browser/stores/project-selectors';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import {
  workbenchSidebarGroupsMemento,
  workbenchSidebarMemento,
  type SidebarProjectGroup,
  type WorkbenchSidebarGroupsState,
  type WorkbenchSidebarState,
} from '@core/features/workbench/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import {
  registeredTaskData,
  unregisteredTaskData,
} from '@core/primitives/task-state/browser/task-state';
export type SidebarTaskSortBy = WorkbenchSidebarState['taskSortBy'];

export type TaskSortKind = 'created' | 'updated';

export function sortKindFor(sortBy: SidebarTaskSortBy): TaskSortKind {
  return sortBy === 'created-at' ? 'created' : 'updated';
}

export function getSortInstant(task: TaskStore, kind: TaskSortKind): string | undefined {
  const reg = registeredTaskData(task);
  if (reg) {
    if (kind === 'created') return reg.createdAt;
    return reg.lastInteractedAt ?? reg.updatedAt;
  }
  const u = unregisteredTaskData(task);
  if (u) {
    if (kind === 'created') return u.createdAt;
    return u.lastInteractedAt;
  }
  return undefined;
}

function isVisibleRegularTask(task: TaskStore): boolean {
  return (
    task.data.type !== 'automation-run' &&
    (task.state === 'unregistered' || !('archivedAt' in task.data && task.data.archivedAt))
  );
}

export type SidebarRow =
  | { kind: 'group'; groupId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string };

/** A contiguous run of projects in the sidebar: the ungrouped section (`group: null`) or one group. */
export type SidebarProjectSection = {
  group: SidebarProjectGroup | null;
  projectIds: string[];
};

function newGroupId(): string {
  return `group-${crypto.randomUUID()}`;
}

export class SidebarStore {
  private _handle: MementoHandle<WorkbenchSidebarState> | undefined;
  private _fallbackState: WorkbenchSidebarState = workbenchSidebarMemento.default;
  private readonly _revealedProjectIds = observable.set<string>();
  private _groupsHandle: MementoHandle<WorkbenchSidebarGroupsState> | undefined;
  private _fallbackGroupsState: WorkbenchSidebarGroupsState = workbenchSidebarGroupsMemento.default;
  /** Group edits made before the memento is attached, replayed onto the stored state on attach. */
  private _pendingGroupUpdates: Array<
    (current: WorkbenchSidebarGroupsState) => WorkbenchSidebarGroupsState
  > = [];
  /** Collapsed groups temporarily opened to show a navigation target; never persisted. */
  private readonly _revealedGroupIds = observable.set<string>();
  /**
   * What is folded while a drag is in progress, never persisted: dragging a
   * group folds every group and project, dragging a project folds every project.
   */
  private _dragFold: 'groups' | 'projects' | null = null;
  /** Collapsed groups opened by hovering them while dragging a project. */
  private readonly _dragOpenedGroupIds = observable.set<string>();

  constructor(private readonly projectManager: ProjectManagerStore) {
    // `_handle` must stay observable: computeds reading `state` before the
    // memento handle is attached would otherwise capture zero dependencies
    // and freeze at the fallback value forever.
    makeAutoObservable<
      SidebarStore,
      | '_fallbackState'
      | '_handle'
      | '_revealedProjectIds'
      | '_fallbackGroupsState'
      | '_pendingGroupUpdates'
      | '_groupsHandle'
      | '_revealedGroupIds'
      | '_dragFold'
      | '_dragOpenedGroupIds'
      | 'projectManager'
    >(this, {
      _fallbackState: false,
      _handle: observable.ref,
      _revealedProjectIds: false,
      _fallbackGroupsState: false,
      _pendingGroupUpdates: false,
      _groupsHandle: observable.ref,
      _revealedGroupIds: false,
      _dragOpenedGroupIds: false,
      projectManager: false,
      expandedProjectIds: computed.struct,
      sidebarRows: computed,
      projectSections: computed,
      pinnedSidebarEntries: computed,
    });
  }

  get projectOrder(): string[] {
    return this.state.projectOrder;
  }

  get taskOrderByProject(): Record<string, string[]> {
    return this.state.taskOrderByProject;
  }

  get expandedProjectIds(): ReadonlySet<string> {
    if (this._dragFold) return new Set();
    return new Set([...this.state.expandedProjectIds, ...this._revealedProjectIds]);
  }

  get taskSortBy(): SidebarTaskSortBy {
    return this.state.taskSortBy;
  }

  attachMemento(handle: MementoHandle<WorkbenchSidebarState>): void {
    if (this._handle) throw new Error('Sidebar memento is already attached');
    this._handle = handle;
  }

  attachGroupsMemento(handle: MementoHandle<WorkbenchSidebarGroupsState>): void {
    if (this._groupsHandle) throw new Error('Sidebar groups memento is already attached');
    this._groupsHandle = handle;
    const pending = this._pendingGroupUpdates;
    this._pendingGroupUpdates = [];
    for (const update of pending) handle.update(update);
  }

  get orderedProjects(): ProjectStore[] {
    const all = Array.from(this.projectManager.projects.values());

    return [...all].sort((a, b) => {
      const ai = this.projectOrder.indexOf(a.id);
      const bi = this.projectOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return this.compareSidebarProjects(a, b);
      if (ai === -1) return -1;
      if (bi === -1) return 1;
      return ai - bi;
    });
  }

  get projectGroups(): SidebarProjectGroup[] {
    return this.groupsState.groups;
  }

  /** Whether a group's projects are hidden: collapsed by the user and not revealed for navigation. */
  isGroupCollapsed(groupId: string): boolean {
    if (this._dragFold === 'groups') return true;
    const group = this.projectGroups.find((g) => g.id === groupId);
    return (
      !!group?.collapsed &&
      !this._revealedGroupIds.has(groupId) &&
      !this._dragOpenedGroupIds.has(groupId)
    );
  }

  /** Whether a drag has folded the sidebar; the folded state is temporary. */
  get isDragFolded(): boolean {
    return this._dragFold !== null;
  }

  /** Fold the sidebar for dragging a group or a project, until `endDragFold`. */
  beginDragFold(kind: 'group' | 'project'): void {
    this._dragFold = kind === 'group' ? 'groups' : 'projects';
    this._dragOpenedGroupIds.clear();
  }

  /** Open a collapsed group while a project is dragged over it. */
  openGroupWhileDragging(groupId: string): void {
    if (this._dragFold === 'projects') this._dragOpenedGroupIds.add(groupId);
  }

  /**
   * Restore the sidebar after a drag. A group opened by hovering stays open
   * when the project was dropped into it (`keepOpenGroupId`).
   */
  endDragFold(keepOpenGroupId?: string | null): void {
    if (keepOpenGroupId && this._dragOpenedGroupIds.has(keepOpenGroupId)) {
      this.setGroupCollapsed(keepOpenGroupId, false);
    }
    this._dragFold = null;
    this._dragOpenedGroupIds.clear();
  }

  /** The group a project belongs to, or `undefined` when it is ungrouped (or its group is gone). */
  groupIdForProject(projectId: string): string | undefined {
    const groupId = this.groupsState.groupByProjectId[projectId];
    if (!groupId) return undefined;
    return this.projectGroups.some((g) => g.id === groupId) ? groupId : undefined;
  }

  /**
   * Projects split into display sections: ungrouped projects first, then each
   * group in order. Every section lists projects in `orderedProjects` order and
   * includes projects hidden by a collapsed group.
   */
  get projectSections(): SidebarProjectSection[] {
    const ungrouped: string[] = [];
    const byGroup = new Map<string, string[]>(this.projectGroups.map((g) => [g.id, []]));
    for (const project of this.orderedProjects) {
      const groupId = this.groupIdForProject(project.id);
      const section = (groupId && byGroup.get(groupId)) || ungrouped;
      section.push(project.id);
    }
    return [
      { group: null, projectIds: ungrouped },
      ...this.projectGroups.map((group) => ({ group, projectIds: byGroup.get(group.id) ?? [] })),
    ];
  }

  get sidebarRows(): SidebarRow[] {
    const rows: SidebarRow[] = [];
    for (const section of this.projectSections) {
      if (section.group) {
        rows.push({ kind: 'group', groupId: section.group.id });
        if (this.isGroupCollapsed(section.group.id)) continue;
      }
      for (const projectId of section.projectIds) {
        this.pushProjectRows(rows, projectId);
      }
    }
    return rows;
  }

  private pushProjectRows(rows: SidebarRow[], projectId: string): void {
    const project = this.projectManager.projects.get(projectId);
    if (!project) return;
    rows.push({ kind: 'project', projectId });
    const context = asAvailableProject(project);
    if (this.expandedProjectIds.has(projectId) && context) {
      const tasks = Array.from(context.get(taskManagerStoreToken).tasks.values()).filter(
        isVisibleRegularTask
      );
      const manualOrder = this.taskOrderByProject[projectId];
      const ordered = manualOrder?.length
        ? this.mergeTaskOrder(projectId, tasks)
        : this.sortTasksForSidebar(tasks);
      for (const task of ordered) {
        if (task.data.isPinned) continue;
        rows.push({ kind: 'task', projectId, taskId: task.data.id });
      }
    }
  }

  /** Visible unpinned tasks in the same order they are rendered in the project tree. */
  get visibleTaskEntries(): { projectId: string; taskId: string }[] {
    return this.sidebarRows
      .filter((row): row is Extract<SidebarRow, { kind: 'task' }> => row.kind === 'task')
      .map(({ projectId, taskId }) => ({ projectId, taskId }));
  }

  /** Flat list of pinned tasks from available Project contexts, in project-tree sort order. */
  get pinnedSidebarEntries(): { projectId: string; taskId: string }[] {
    const pairs: { projectId: string; task: TaskStore }[] = [];
    for (const project of this.projectManager.projects.values()) {
      const context = asAvailableProject(project);
      if (!context) continue;
      const projectId = project.id;
      for (const task of context.get(taskManagerStoreToken).tasks.values()) {
        if (!isVisibleRegularTask(task) || !task.data.isPinned) continue;
        pairs.push({ projectId, task });
      }
    }
    pairs.sort((a, b) => this.compareSidebarTasks(a.task, b.task));
    return pairs.map(({ projectId, task }) => ({ projectId, taskId: task.data.id }));
  }

  /**
   * Visible unpinned task IDs for a project in sidebar order. Archived tasks are
   * and automation tasks are excluded. Independent of expand state so Next/Previous
   * Task navigation works even when the project is collapsed.
   */
  visibleTaskIdsForProject(projectId: string): string[] {
    const project = this.projectManager.projects.get(projectId);
    if (!project) return [];
    const context = asAvailableProject(project);
    if (!context) return [];
    const tasks = Array.from(context.get(taskManagerStoreToken).tasks.values()).filter(
      (task) => isVisibleRegularTask(task) && !task.data.isPinned
    );
    const manualOrder = this.taskOrderByProject[projectId];
    const ordered = manualOrder?.length
      ? this.mergeTaskOrder(projectId, tasks)
      : this.sortTasksForSidebar(tasks);
    return ordered.map((t) => t.data.id);
  }

  get isEmpty(): boolean {
    return this.projectManager.projects.size === 0;
  }

  /** Called on first load when no snapshot exists — expand all known projects. */
  expandAllProjects(): void {
    this.updateState((current) => ({
      ...current,
      expandedProjectIds: this.orderedProjects.map((project) => project.id),
    }));
  }

  toggleProjectExpanded(projectId: string): void {
    const isPersisted = this.state.expandedProjectIds.includes(projectId);
    const isRevealed = this._revealedProjectIds.has(projectId);
    if (isPersisted || isRevealed) {
      this._revealedProjectIds.delete(projectId);
      if (isPersisted) {
        this.updateExpandedProjects((ids) => ids.filter((id) => id !== projectId));
      }
      return;
    }
    this.updateExpandedProjects((ids) => [...ids, projectId]);
  }

  revealProject(projectId: string): void {
    if (!this.expandedProjectIds.has(projectId)) {
      this._revealedProjectIds.add(projectId);
    }
    const groupId = this.groupIdForProject(projectId);
    if (groupId && this.isGroupCollapsed(groupId)) {
      this._revealedGroupIds.add(groupId);
    }
  }

  setTaskSortBy(sortBy: SidebarTaskSortBy): void {
    this.updateState((current) => ({ ...current, taskSortBy: sortBy }));
  }

  /** Set the sort key and clear all manual task orders so the list fully re-sorts. */
  applySort(sortBy: SidebarTaskSortBy): void {
    this.updateState((current) => ({
      ...current,
      taskSortBy: sortBy,
      taskOrderByProject: {},
    }));
  }

  setProjectOrder(ids: string[]): void {
    this.updateState((current) => ({ ...current, projectOrder: ids }));
  }

  /** Create a group, optionally moving a project into it. Returns the new group's id. */
  createGroup(name: string, projectId?: string): string {
    const id = newGroupId();
    this.updateGroupsState((current) => ({
      ...current,
      groups: [...current.groups, { id, name, collapsed: false }],
      groupByProjectId: projectId
        ? this.withProjectGroup(current.groupByProjectId, projectId, id)
        : current.groupByProjectId,
    }));
    return id;
  }

  renameGroup(groupId: string, name: string): void {
    this.updateGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, name } : g)));
  }

  toggleGroupCollapsed(groupId: string): void {
    if (this._revealedGroupIds.has(groupId)) {
      // Shown only for navigation; the persisted state is already collapsed.
      this._revealedGroupIds.delete(groupId);
      return;
    }
    this.setGroupCollapsed(groupId, !this.isGroupCollapsed(groupId));
  }

  /** Delete a group. Its projects stay in the sidebar as ungrouped projects. */
  deleteGroup(groupId: string): void {
    this._revealedGroupIds.delete(groupId);
    this.updateGroupsState((current) => ({
      ...current,
      groups: current.groups.filter((g) => g.id !== groupId),
      groupByProjectId: Object.fromEntries(
        Object.entries(current.groupByProjectId).filter(([, gid]) => gid !== groupId)
      ),
    }));
  }

  /** Move a group one place up (`-1`) or down (`1`). */
  moveGroup(groupId: string, direction: -1 | 1): void {
    const from = this.projectGroups.findIndex((g) => g.id === groupId);
    if (from === -1) return;
    // `moveGroupTo` counts positions before removal, so "down" skips one slot.
    this.moveGroupTo(groupId, direction === -1 ? from - 1 : from + 2);
  }

  /**
   * Move a group to `index` in the group order, where `index` counts positions
   * before the group is removed (0 = first, `groups.length` = last).
   */
  moveGroupTo(groupId: string, index: number): void {
    this.updateGroups((groups) => {
      const from = groups.findIndex((g) => g.id === groupId);
      if (from === -1 || index < 0 || index > groups.length) return groups;
      const to = index > from ? index - 1 : index;
      if (to === from) return groups;
      const next = [...groups];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  /** Move a project into a group (`null` = ungrouped), keeping its relative order. */
  moveProjectToGroup(projectId: string, groupId: string | null): void {
    this.updateGroupsState((current) => ({
      ...current,
      groupByProjectId: this.withProjectGroup(current.groupByProjectId, projectId, groupId),
    }));
  }

  /**
   * Place a project at `index` within a section (`groupId: null` = ungrouped).
   * Rewrites `projectOrder` to the full display order so section order and the
   * stored order stay consistent. A collapsed target group is expanded so the
   * dropped project stays visible.
   */
  placeProject(projectId: string, groupId: string | null, index: number): void {
    const sections = this.projectSections.map((section) => ({
      groupId: section.group?.id ?? null,
      projectIds: section.projectIds.filter((id) => id !== projectId),
    }));
    const target = sections.find((section) => section.groupId === groupId);
    if (!target) return;
    target.projectIds.splice(Math.max(0, Math.min(index, target.projectIds.length)), 0, projectId);
    this.updateGroupsState((current) => ({
      ...current,
      groups: current.groups.map((g) => (g.id === groupId ? { ...g, collapsed: false } : g)),
      groupByProjectId: this.withProjectGroup(current.groupByProjectId, projectId, groupId),
    }));
    this.setProjectOrder(sections.flatMap((section) => section.projectIds));
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
    // New tasks (not in the manual order) are sorted by date and prepended so
    // they always appear at the top rather than buried after manually-ordered tasks.
    const newTasks = tasks
      .filter((t) => !seen.has(t.data.id))
      .sort((a, b) => this.compareSidebarTasks(a, b));
    return [...newTasks, ...result];
  }

  setTaskOrder(projectId: string, orderedIds: string[]): void {
    this.updateState((current) => ({
      ...current,
      taskOrderByProject: { ...current.taskOrderByProject, [projectId]: orderedIds },
    }));
  }

  private get state(): WorkbenchSidebarState {
    return this._handle?.value ?? this._fallbackState;
  }

  private updateState(update: (current: WorkbenchSidebarState) => WorkbenchSidebarState): void {
    if (this._handle) {
      this._handle.update(update);
    } else {
      this._fallbackState = update(this._fallbackState);
    }
  }

  private get groupsState(): WorkbenchSidebarGroupsState {
    return this._groupsHandle?.value ?? this._fallbackGroupsState;
  }

  private updateGroupsState(
    update: (current: WorkbenchSidebarGroupsState) => WorkbenchSidebarGroupsState
  ): void {
    if (this._groupsHandle) {
      this._groupsHandle.update(update);
    } else {
      this._fallbackGroupsState = update(this._fallbackGroupsState);
      this._pendingGroupUpdates.push(update);
    }
  }

  private updateGroups(update: (current: SidebarProjectGroup[]) => SidebarProjectGroup[]): void {
    this.updateGroupsState((current) => ({ ...current, groups: update(current.groups) }));
  }

  private setGroupCollapsed(groupId: string, collapsed: boolean): void {
    this.updateGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, collapsed } : g)));
  }

  /**
   * Assign (or with `null`, clear) a project's group. Entries for projects that
   * no longer exist are dropped on every write so the map cannot grow unbounded.
   */
  private withProjectGroup(
    current: Record<string, string>,
    projectId: string,
    groupId: string | null
  ): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [id, gid] of Object.entries(current)) {
      if (id !== projectId && this.projectManager.projects.has(id)) next[id] = gid;
    }
    if (groupId) next[projectId] = groupId;
    return next;
  }

  private updateExpandedProjects(update: (current: string[]) => string[]): void {
    this.updateState((current) => ({
      ...current,
      expandedProjectIds: update(current.expandedProjectIds),
    }));
  }

  private compareSidebarTasks(a: TaskStore, b: TaskStore): number {
    const kind = sortKindFor(this.taskSortBy);
    const ia = getSortInstant(a, kind) ?? '';
    const ib = getSortInstant(b, kind) ?? '';
    const d = ib.localeCompare(ia);
    if (d !== 0) return d;
    return a.data.id.localeCompare(b.data.id);
  }

  private compareSidebarProjects(a: ProjectStore, b: ProjectStore): number {
    const d = b.createdAt.localeCompare(a.createdAt);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  }

  private sortTasksForSidebar(tasks: TaskStore[]): TaskStore[] {
    return [...tasks].sort((a, b) => this.compareSidebarTasks(a, b));
  }
}
