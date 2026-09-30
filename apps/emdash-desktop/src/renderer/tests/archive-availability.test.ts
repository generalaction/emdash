import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskList } from '@core/features/projects/browser/components/task-view/task-list';
import type {
  ReadyTask,
  TaskListViewModel,
} from '@core/features/projects/browser/components/task-view/task-list-model';
import { TaskRow } from '@core/features/projects/browser/components/task-view/task-row';
import { TaskScope } from '@core/features/tasks/browser/task-scope';
import type { taskViewScope } from '@core/features/tasks/contributions/scopes';
import { SidebarTaskItem } from '@core/features/workbench/browser/sidebar/task-item';
import type { ViewScopeImpl } from '@core/primitives/view-scopes/api';

const mocks = vi.hoisted(() => {
  const task = {
    state: 'provisioned',
    data: { id: 'task-1', projectId: 'project-1', name: 'Offline task', type: 'regular' },
  };
  return {
    task,
    manager: {
      tasks: new Map([[task.data.id, task]]),
      archiveTask: vi.fn().mockResolvedValue(undefined),
    },
    taskView: { count: 1, selectedIds: new Set(['task-1']), tab: 'active', clear: vi.fn() },
    menu: vi.fn((_props: { archiveDisabledReason?: string; onArchive(): void }) => null),
    button: vi.fn((_props: { 'aria-label'?: string; disabled?: boolean; onClick(): void }) => null),
    useViewScope: vi.fn((..._args: unknown[]) => ({ instance: undefined })),
    hostAction: vi.fn(() => ({ kind: 'disabled', reason: 'Host disconnected' })),
  };
});

vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  getTaskStore: () => mocks.task,
  getRegisteredTaskData: () => mocks.task.data,
  getTaskManagerStore: () => mocks.manager,
  taskHostActionAvailability: mocks.hostAction,
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectViewStore: () => ({ taskView: mocks.taskView }),
}));
vi.mock('@core/features/projects/contributions/browser/project-availability-ui', () => ({
  projectAvailabilityUiContribution: {
    getLiveActionDisabledReason: () => 'Host disconnected',
    defaultLiveActionDisabledReason: 'Host disconnected',
  },
}));
vi.mock('@core/manifests/browser/project-availability-ui', () => ({
  projectAvailabilityUi: {
    getLiveActionDisabledReason: () => 'Host disconnected',
    defaultLiveActionDisabledReason: 'Host disconnected',
  },
}));
vi.mock('@core/features/tasks/contributions/browser/task-context-menu', () => ({
  TaskContextMenu: mocks.menu,
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useOpenModal: () => vi.fn(),
  openModal: vi.fn(),
}));
vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
  useViewParams: () => ({ taskId: 'task-1', projectId: 'project-1' }),
  useCurrentViewParams: () => ({ params: { projectId: 'project-1' } }),
  useWorkspaceSlots: () => ({ currentView: 'project' }),
}));
vi.mock('@core/primitives/view-scopes/react', () => ({
  useViewScope: mocks.useViewScope,
  ViewScopeInstanceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@core/features/source-control/api/browser/stores/task-source-control-selectors', () => ({
  getTaskGitCheckoutStore: () => null,
  getTaskPrAssociationStore: () => ({ pullRequests: [] }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: vi.fn(),
}));
vi.mock('@core/features/source-control/api/browser/git-action-handlers', () => ({}));
vi.mock('@core/features/workbench/api/browser/task-composition-selectors', () => ({
  getTaskWorkspace: () => null,
}));
vi.mock('@core/features/workbench/contributions/browser/app-stores', () => ({
  getSidebarStore: vi.fn(),
}));
vi.mock('@core/features/browser/api/browser/browser-controls-registry', () => ({
  browserControlsRegistry: {},
}));
vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: {} }),
}));
vi.mock('@core/features/conversations/api/browser/conversation-selectors', () => ({
  taskAgentStatus: () => 'idle',
  taskConversationStats: () => ({ count: 0 }),
}));
vi.mock('@core/features/agents/contributions/browser/stacked-agent-logos', () => ({
  StackedAgentLogos: () => null,
}));
vi.mock('@core/features/workbench/browser/sidebar/task-sidebar-agent-status', () => ({
  TaskSidebarTrailingSlot: () => null,
}));
vi.mock('@core/features/tasks/contributions/browser/task-git-diff-stats', () => ({
  TaskGitDiffStats: () => null,
}));
vi.mock('@root/src/core/services/pull-requests/api', () => ({ selectCurrentPr: () => null }));
vi.mock('@root/src/core/services/pull-requests/browser/components/pr-badge', () => ({
  PrBadge: () => null,
}));
vi.mock('@core/features/tasks/api/browser/delete-selected-tasks', () => ({
  deleteSelectedTasks: vi.fn(),
}));
vi.mock('@core/primitives/keybindings/browser', () => ({ useSearchFocusHotkeys: vi.fn() }));
vi.mock('@core/primitives/keybindings/browser/shortcut', () => ({ BoundShortcut: () => null }));
vi.mock('@emdash/ui/react/primitives', () => ({
  Button: mocks.button,
  Checkbox: () => null,
  RelativeTime: () => null,
  ToggleGroup: {},
  toast: { error: vi.fn() },
}));
vi.mock('@emdash/ui/react/components', () => ({
  ListPopoverCard: ({ children }: { children: ReactNode }) => children,
  AgentStatus: () => null,
}));
vi.mock('@emdash/ui/react/patterns', () => ({
  CollectionView: ({ footer }: { footer: ReactNode }) => footer,
  CollectionToolbar: {},
  SortSelect: () => null,
}));
vi.mock('@core/features/projects/browser/components/task-view/task-list-model', () => ({
  createTaskListView: () => ({ Root: ({ children }: { children: ReactNode }) => children }),
}));

describe('archive UI availability for provisioned tasks on an unreachable host', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enables and executes the task archive command', () => {
    renderToStaticMarkup(
      // oxlint-disable-next-line react/no-children-prop -- the node test project is .ts-only; createElement needs TaskScope's required children prop.
      createElement(TaskScope, { projectId: 'project-1', taskId: 'task-1', children: null })
    );
    const implementation = mocks.useViewScope.mock.calls[0]?.[1] as unknown as ViewScopeImpl<
      typeof taskViewScope
    >;
    const command = implementation['task.archive']({ projectId: 'project-1', taskId: 'task-1' });
    expect(command.availability?.()).toEqual({ kind: 'enabled' });
    command.execute(undefined, 'keybinding');
    expect(mocks.manager.archiveTask).toHaveBeenCalledWith('task-1');
  });

  it.each(['sidebar', 'project row'])('enables archive in the %s context menu', (surface) => {
    if (surface === 'sidebar') {
      renderToStaticMarkup(
        createElement(SidebarTaskItem, { projectId: 'project-1', taskId: 'task-1' })
      );
    } else {
      const view = {
        useItem: () => ({ id: 'task-1' }),
        useSelection: () => ({ isSelected: () => false }),
      } as unknown as TaskListViewModel;
      renderToStaticMarkup(
        createElement(TaskRow, { task: mocks.task as unknown as ReadyTask, view })
      );
    }
    const props = mocks.menu.mock.calls[0]![0];
    expect(props.archiveDisabledReason).toBeUndefined();
    props.onArchive();
    expect(mocks.manager.archiveTask).toHaveBeenCalledWith('task-1');
  });

  it('enables bulk archive with a provisioned task selected', () => {
    renderToStaticMarkup(createElement(TaskList));
    const buttons = mocks.button.mock.calls.map(([props]) => props);
    const archive = buttons.find((props) => props['aria-label']?.startsWith('Archive'));
    expect(archive).toBeDefined();
    expect(archive?.disabled).not.toBe(true);
    archive?.onClick();
    expect(mocks.manager.archiveTask).toHaveBeenCalledWith('task-1');
    expect(mocks.taskView.clear).toHaveBeenCalledOnce();
  });
});
