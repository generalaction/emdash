import { useEffect } from 'react';
import { projectViewDef } from '@core/features/projects/contributions/views';
import {
  getRegisteredTaskData,
  getTaskView,
} from '@core/features/tasks/browser/stores/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { ViewId } from '@core/manifests/view-catalog';
import type { ShortcutSettingsKey } from '@core/primitives/commands/api/shortcuts';
import { commandRegistry } from '@renderer/lib/commands/registry';
import {
  type WorkspaceLayoutContextValue,
  useWorkspaceLayoutContext,
} from '@renderer/lib/layout/layout-provider';
import { useViewParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';

export function BrowserAppShortcutEvents() {
  const showCommandPalette = useShowModal('commandPaletteModal');
  const { toggleLeft, toggleZenMode } = useWorkspaceLayoutContext();
  const { currentView } = useWorkspaceSlots();
  const taskParams = useViewParams(taskViewDef);
  const projectParams = useViewParams(projectViewDef);

  const currentProjectId =
    currentView === 'task'
      ? taskParams?.projectId
      : currentView === 'project'
        ? projectParams?.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams?.taskId : undefined;

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.host.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type !== 'browser-app-shortcut') return;
          if (commandRegistry.dispatch(event.shortcutKey)) return;
          dispatchAppOnlyShortcut(event.shortcutKey, {
            currentProjectId,
            currentTaskId,
            currentView,
            exitSettings: () => appState.navigation.toggleSettings(),
            showCommandPalette,
            toggleLeft,
            toggleZenMode,
          });
        },
        onGap: () => {},
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [currentProjectId, currentTaskId, currentView, showCommandPalette, toggleLeft, toggleZenMode]);

  return null;
}

function dispatchAppOnlyShortcut(
  shortcutKey: ShortcutSettingsKey,
  context: {
    currentProjectId: string | undefined;
    currentTaskId: string | undefined;
    currentView: ViewId;
    exitSettings: () => void;
    showCommandPalette: (input: {
      projectId?: string;
      taskId?: string;
      workspaceId?: string;
    }) => void;
    toggleLeft: () => void;
    toggleZenMode: WorkspaceLayoutContextValue['toggleZenMode'];
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
      {
        const taskView =
          context.currentProjectId && context.currentTaskId
            ? getTaskView(context.currentProjectId, context.currentTaskId)
            : undefined;
        context.toggleZenMode(
          taskView
            ? {
                isCollapsed: taskView.isSidebarCollapsed,
                setCollapsed: (collapsed) => taskView.setSidebarCollapsed(collapsed),
              }
            : undefined
        );
      }
      break;
    case 'closeModal':
      if (context.currentView === 'settings' && !modalStore.isOpen) {
        context.exitSettings();
      }
      break;
  }
}
