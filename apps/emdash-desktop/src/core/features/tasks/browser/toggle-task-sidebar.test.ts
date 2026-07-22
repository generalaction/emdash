import { describe, expect, it, vi } from 'vitest';
import type { SidebarTab } from '@core/features/tasks/api/browser/types';
import { toggleTaskSidebarTab, type TaskSidebarState } from './toggle-task-sidebar';

function createState(
  sidebarTab: SidebarTab,
  isSidebarCollapsed: boolean
): TaskSidebarState & { sidebarTab: SidebarTab; isSidebarCollapsed: boolean } {
  const state = {
    sidebarTab,
    isSidebarCollapsed,
    setSidebarTab: vi.fn((tab: SidebarTab) => {
      state.sidebarTab = tab;
    }),
    setSidebarCollapsed: vi.fn((collapsed: boolean) => {
      state.isSidebarCollapsed = collapsed;
    }),
  };
  return state;
}

describe('toggleTaskSidebarTab', () => {
  it('collapses an already-open selected tab', () => {
    const state = createState('changes', false);

    toggleTaskSidebarTab(state, 'changes');

    expect(state.isSidebarCollapsed).toBe(true);
    expect(state.setSidebarTab).not.toHaveBeenCalled();
  });

  it('switches tabs and expands the sidebar', () => {
    const state = createState('conversations', false);

    toggleTaskSidebarTab(state, 'files');

    expect(state.sidebarTab).toBe('files');
    expect(state.isSidebarCollapsed).toBe(false);
  });

  it('opens the selected tab when the sidebar is collapsed', () => {
    const state = createState('changes', true);

    toggleTaskSidebarTab(state, 'changes');

    expect(state.sidebarTab).toBe('changes');
    expect(state.isSidebarCollapsed).toBe(false);
  });
});
