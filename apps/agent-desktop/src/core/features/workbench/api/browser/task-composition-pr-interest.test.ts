import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskComposition } from './task-composition';

const mocks = vi.hoisted(() => ({
  navigation: { currentRef: { viewId: 'task', params: { projectId: 'project', taskId: 'task' } } },
  project: vi.fn(),
}));
vi.mock('@core/primitives/navigation/browser/navigation-selectors', () => ({
  getNavigation: () => mocks.navigation,
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  getProjectStore: mocks.project,
}));

function harness() {
  const task = Object.create(TaskComposition.prototype) as TaskComposition;
  const chrome = { state: { sidebarCollapsed: false, sidebarTab: 'changes' } };
  const workspaceChrome = { state: { zen: { active: false } } };
  const checkout = { hasData: true };
  const space = { isHydrated: true };
  const sections = { pullRequests: true };
  mocks.project.mockReturnValue({
    context: { kind: 'available', context: { get: () => workspaceChrome } },
  });
  Object.defineProperties(task, {
    projectId: { value: 'project' },
    taskId: { value: 'task' },
    chrome: { value: chrome },
    space: { value: space },
    diffView: { value: { changesView: { expandedSections: sections } } },
    _workspace: { value: { get: () => checkout } },
  });
  return { task, chrome, workspaceChrome, checkout, space, sections };
}

beforeEach(() => {
  mocks.navigation.currentRef = {
    viewId: 'task',
    params: { projectId: 'project', taskId: 'task' },
  };
});

describe('TaskComposition PR panel interest', () => {
  it('follows navigation, sidebar visibility, zen, tab, section and readiness', () => {
    const h = harness();
    expect(h.task.isPrPanelVisible).toBe(true);
    const gates: Array<() => () => void> = [
      () => {
        mocks.navigation.currentRef.viewId = 'home';
        return () => {
          mocks.navigation.currentRef.viewId = 'task';
        };
      },
      () => {
        mocks.navigation.currentRef.params.taskId = 'other';
        return () => {
          mocks.navigation.currentRef.params.taskId = 'task';
        };
      },
      () => {
        mocks.navigation.currentRef.params.projectId = 'other';
        return () => {
          mocks.navigation.currentRef.params.projectId = 'project';
        };
      },
      () => {
        h.chrome.state.sidebarCollapsed = true;
        return () => {
          h.chrome.state.sidebarCollapsed = false;
        };
      },
      () => {
        h.chrome.state.sidebarTab = 'files';
        return () => {
          h.chrome.state.sidebarTab = 'changes';
        };
      },
      () => {
        h.workspaceChrome.state.zen.active = true;
        return () => {
          h.workspaceChrome.state.zen.active = false;
        };
      },
      () => {
        h.sections.pullRequests = false;
        return () => {
          h.sections.pullRequests = true;
        };
      },
      () => {
        h.checkout.hasData = false;
        return () => {
          h.checkout.hasData = true;
        };
      },
      () => {
        h.space.isHydrated = false;
        return () => {
          h.space.isHydrated = true;
        };
      },
    ];
    for (const hide of gates) {
      const restore = hide();
      expect(h.task.isPrPanelVisible).toBe(false);
      restore();
      expect(h.task.isPrPanelVisible).toBe(true);
    }
    mocks.project.mockReturnValue(undefined);
    expect(h.task.isPrPanelVisible).toBe(false);
  });
});
