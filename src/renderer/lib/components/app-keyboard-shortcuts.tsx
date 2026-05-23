import { useHotkey } from '@tanstack/react-hotkeys';
import { useObserver } from 'mobx-react-lite';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useAppShortcutsEnabled } from '@renderer/lib/hooks/use-app-shortcuts-enabled';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { modalStore } from '@renderer/lib/modal/modal-store';

export function AppKeyboardShortcuts() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const showCommandPalette = useShowModal('commandPaletteModal');
  const { toggleLeft } = useWorkspaceLayoutContext();
  const { navigate } = useNavigate();
  const appShortcutsEnabled = useAppShortcutsEnabled();

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
    { enabled: appShortcutsEnabled && commandPaletteHotkey !== null }
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
    enabled: appShortcutsEnabled && toggleLeftSidebarHotkey !== null,
  });

  return null;
}
