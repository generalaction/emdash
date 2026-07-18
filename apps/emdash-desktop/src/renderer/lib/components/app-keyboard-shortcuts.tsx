import { useHotkey } from '@tanstack/react-hotkeys';
import { useObserver } from 'mobx-react-lite';
import { useEffect } from 'react';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useAppSettingsKey } from '@core/features/settings/browser/use-app-settings-key';
import {
  getRegisteredTaskData,
  getTaskView,
} from '@core/features/tasks/browser/stores/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useViewParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { useOpenModal } from '@renderer/lib/modal/api';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { appState } from '@renderer/lib/stores/app-state';

export function AppKeyboardShortcuts() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const openCommandPalette = useOpenModal('commandPaletteModal');
  const { exitZenMode, toggleLeft, toggleZenMode } = useWorkspaceLayoutContext();

  const commandPaletteHotkey = getEffectiveHotkey('commandPalette', keyboard);
  const closeModalHotkey = getEffectiveHotkey('closeModal', keyboard);
  const toggleLeftSidebarHotkey = getEffectiveHotkey('toggleLeftSidebar', keyboard);
  const zenModeHotkey = getEffectiveHotkey('zenMode', keyboard);

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

  const currentWorkspaceId = useObserver(() => {
    if (!currentProjectId || !currentTaskId) return undefined;
    return getRegisteredTaskData(currentProjectId, currentTaskId)?.workspaceId ?? undefined;
  });

  useEffect(() => () => exitZenMode(), [currentProjectId, currentTaskId, currentView, exitZenMode]);

  useHotkey(
    getHotkeyRegistration('commandPalette', keyboard),
    () => {
      void openCommandPalette({
        projectId: currentProjectId,
        taskId: currentTaskId,
        workspaceId: currentWorkspaceId,
      });
    },
    { enabled: commandPaletteHotkey !== null }
  );

  useHotkey(
    getHotkeyRegistration('closeModal', keyboard),
    () => {
      if (currentView === 'settings' && !modalStore.isOpen) {
        appState.navigation.toggleSettings();
      }
    },
    { enabled: currentView === 'settings' && closeModalHotkey !== null }
  );

  useHotkey(getHotkeyRegistration('toggleLeftSidebar', keyboard), () => toggleLeft(), {
    enabled: toggleLeftSidebarHotkey !== null,
  });

  useHotkey(
    getHotkeyRegistration('zenMode', keyboard),
    () => {
      const taskView =
        currentProjectId && currentTaskId
          ? getTaskView(currentProjectId, currentTaskId)
          : undefined;
      toggleZenMode(
        taskView
          ? {
              isCollapsed: taskView.isSidebarCollapsed,
              setCollapsed: (collapsed) => taskView.setSidebarCollapsed(collapsed),
            }
          : undefined
      );
    },
    { enabled: zenModeHotkey !== null, ignoreInputs: true }
  );

  return null;
}
