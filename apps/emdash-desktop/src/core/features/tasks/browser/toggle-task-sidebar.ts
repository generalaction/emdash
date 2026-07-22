import type { SidebarTab } from '@core/features/tasks/api/browser/types';

export type TaskSidebarState = {
  readonly isSidebarCollapsed: boolean;
  readonly sidebarTab: SidebarTab;
  setSidebarCollapsed(collapsed: boolean): void;
  setSidebarTab(tab: SidebarTab): void;
};

export function toggleTaskSidebarTab(taskView: TaskSidebarState, tab: SidebarTab): void {
  if (!taskView.isSidebarCollapsed && taskView.sidebarTab === tab) {
    taskView.setSidebarCollapsed(true);
    return;
  }
  taskView.setSidebarTab(tab);
  taskView.setSidebarCollapsed(false);
}
