import { useHotkey } from '@tanstack/react-hotkeys';
import { useObserver } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { claimNumberHotkey, useNumberHotkeys } from '@renderer/lib/hooks/use-number-hotkeys';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { events } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { numberShortcutChannel } from '@shared/events/appEvents';

export function AppKeyboardShortcuts() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const showCommandPalette = useShowModal('commandPaletteModal');
  const { toggleLeft } = useWorkspaceLayoutContext();
  const { navigate } = useNavigate();

  const commandPaletteHotkey = getEffectiveHotkey('commandPalette', keyboard);
  const closeModalHotkey = getEffectiveHotkey('closeModal', keyboard);
  const toggleLeftSidebarHotkey = getEffectiveHotkey('toggleLeftSidebar', keyboard);

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

  const currentWorkspaceId = useObserver(() => {
    if (!currentProjectId || !currentTaskId) return undefined;
    return getRegisteredTaskData(currentProjectId, currentTaskId)?.workspaceId ?? undefined;
  });

  useHotkey(
    getHotkeyRegistration('commandPalette', keyboard),
    () =>
      showCommandPalette({
        projectId: currentProjectId,
        taskId: currentTaskId,
        workspaceId: currentWorkspaceId,
      }),
    { enabled: commandPaletteHotkey !== null }
  );

  useHotkey(
    getHotkeyRegistration('closeModal', keyboard),
    () => {
      if (currentView === 'settings' && !modalStore.isOpen) {
        (navigate as (viewId: typeof lastNonSettingsView) => void)(lastNonSettingsView);
      }
    },
    { enabled: currentView === 'settings' && closeModalHotkey !== null }
  );

  useHotkey(getHotkeyRegistration('toggleLeftSidebar', keyboard), () => toggleLeft(), {
    enabled: toggleLeftSidebarHotkey !== null,
  });

  // Jump to the Nth task in visual sidebar order: pinned tasks first, then the
  // project tree top to bottom (same source as Next/Previous Task).
  useNumberHotkeys(getEffectiveHotkey('taskByNumber', keyboard), true, (index) => {
    navigateToTaskByIndex(navigate, index);
  });

  // Same shortcut pressed while an in-app browser webview has keyboard focus:
  // the main process forwards it since the renderer never sees those keys.
  useEffect(() => {
    return events.on(numberShortcutChannel, (event) => {
      if (event.family !== 'task') return;
      if (!claimNumberHotkey()) return;
      navigateToTaskByIndex(navigate, event.index);
    });
  }, [navigate]);

  return null;
}

function navigateToTaskByIndex(
  navigate: ReturnType<typeof useNavigate>['navigate'],
  index: number
): void {
  const entries = [...sidebarStore.pinnedSidebarEntries, ...sidebarStore.visibleTaskEntries];
  const entry = entries[index];
  if (entry) navigate('task', entry);
}
