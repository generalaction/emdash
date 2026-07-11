import { useEffect } from 'react';
import type { ViewId } from '@renderer/app/view-registry';
import { getRegisteredTaskData, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { commandRegistry } from '@renderer/lib/commands/registry';
import { events } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import {
  type NavigateFnTyped,
  type NonSettingsViewId,
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { browserAppShortcutChannel } from '@shared/events/appEvents';
import type { ShortcutSettingsKey } from '@shared/shortcuts';

export function BrowserAppShortcutEvents() {
  const showCommandPalette = useShowModal('commandPaletteModal');
  const { setCollapsed, toggleLeft } = useWorkspaceLayoutContext();
  const { navigate } = useNavigate();
  const { currentView, lastNonSettingsView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : undefined;

  useEffect(() => {
    return events.on(browserAppShortcutChannel, ({ shortcutKey }) => {
      if (commandRegistry.dispatch(shortcutKey)) return;

      dispatchAppOnlyShortcut(shortcutKey, {
        currentProjectId,
        currentTaskId,
        currentView,
        lastNonSettingsView,
        navigate,
        setCollapsed,
        showCommandPalette,
        toggleLeft,
      });
    });
  }, [
    currentProjectId,
    currentTaskId,
    currentView,
    lastNonSettingsView,
    navigate,
    setCollapsed,
    showCommandPalette,
    toggleLeft,
  ]);

  return null;
}

function dispatchAppOnlyShortcut(
  shortcutKey: ShortcutSettingsKey,
  context: {
    currentProjectId: string | undefined;
    currentTaskId: string | undefined;
    currentView: ViewId;
    lastNonSettingsView: NonSettingsViewId;
    navigate: NavigateFnTyped;
    setCollapsed: (side: 'left', collapsed: boolean) => void;
    showCommandPalette: (input: {
      projectId?: string;
      taskId?: string;
      workspaceId?: string;
    }) => void;
    toggleLeft: () => void;
  }
): void {
  switch (shortcutKey) {
    case 'commandPalette': {
      const workspaceId =
        context.currentProjectId && context.currentTaskId
          ? (getRegisteredTaskData(context.currentProjectId, context.currentTaskId)?.workspaceId ??
            undefined)
          : undefined;

      context.showCommandPalette({
        projectId: context.currentProjectId,
        taskId: context.currentTaskId,
        workspaceId,
      });
      break;
    }
    case 'toggleLeftSidebar':
      context.toggleLeft();
      break;
    case 'zenMode':
      context.setCollapsed('left', true);
      if (context.currentProjectId && context.currentTaskId) {
        getTaskView(context.currentProjectId, context.currentTaskId)?.setSidebarCollapsed(true);
      }
      break;
    case 'closeModal':
      if (context.currentView === 'settings' && !modalStore.isOpen) {
        (context.navigate as (viewId: ViewId) => void)(context.lastNonSettingsView);
      }
      break;
  }
}
