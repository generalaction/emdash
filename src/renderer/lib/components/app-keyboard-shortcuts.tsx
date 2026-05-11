import { useHotkey } from '@tanstack/react-hotkeys';
  import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
  import {
    getEffectiveHotkey,
    getHotkeyRegistration,
  } from '@renderer/lib/hooks/useKeyboardShortcuts';
  import { useTheme } from '@renderer/lib/hooks/useTheme';
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
    const { toggleTheme } = useTheme();
    const { navigate } = useNavigate();

    const commandPaletteHotkey = getEffectiveHotkey('commandPalette', keyboard);
    const closeModalHotkey = getEffectiveHotkey('closeModal', keyboard);
    const toggleLeftSidebarHotkey = getEffectiveHotkey('toggleLeftSidebar', keyboard);
    const toggleThemeHotkey = getEffectiveHotkey('toggleTheme', keyboard);

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

    useHotkey(
      getHotkeyRegistration('commandPalette', keyboard),
      () => showCommandPalette({ projectId: currentProjectId, taskId: currentTaskId }),
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

    useHotkey(getHotkeyRegistration('toggleTheme', keyboard), () => toggleTheme(), {
      enabled: toggleThemeHotkey !== null,
    });

    return null;
  }