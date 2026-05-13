import { useHotkey } from '@tanstack/react-hotkeys';
import { useObserver } from 'mobx-react-lite';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

/**
 * Mounts global keyboard shortcut handlers that require React context and
 * cannot be handled by the command registry.
 *
 * Renders nothing — exists only to register useHotkey() calls that are always active.
 * Must be mounted inside all relevant providers (ModalProvider, WorkspaceLayoutContext, etc.).
 *
 * Shortcuts handled here:
 *   - commandPalette: needs showModal with current view context
 *   - projectSwitcher: needs showModal
 *   - toggleLeftSidebar: needs useWorkspaceLayoutContext
 *   - toggleTheme: needs useTheme
 *
 * Shortcuts NOT handled here (owned by the command registry via app-commands.ts):
 *   - settings, newProject, newTask, navigateBack, navigateForward
 */
export function AppKeyboardShortcuts() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const showCommandPalette = useShowModal('commandPaletteModal');
  const showProjectSwitcher = useShowModal('projectSwitcherModal');
  const { toggleLeft } = useWorkspaceLayoutContext();
  const { toggleTheme } = useTheme();
  const commandPaletteHotkey = getEffectiveHotkey('commandPalette', keyboard);
  const projectSwitcherHotkey = getEffectiveHotkey('projectSwitcher', keyboard);
  const toggleLeftSidebarHotkey = getEffectiveHotkey('toggleLeftSidebar', keyboard);
  const toggleThemeHotkey = getEffectiveHotkey('toggleTheme', keyboard);

  // Resolve current project/task context for the command palette
  const { currentView } = useWorkspaceSlots();
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
    getHotkeyRegistration('projectSwitcher', keyboard),
    () => showProjectSwitcher({ currentTaskId }),
    { enabled: projectSwitcherHotkey !== null }
  );

  useHotkey(getHotkeyRegistration('toggleLeftSidebar', keyboard), () => toggleLeft(), {
    enabled: toggleLeftSidebarHotkey !== null,
  });

  useHotkey(getHotkeyRegistration('toggleTheme', keyboard), () => toggleTheme(), {
    enabled: toggleThemeHotkey !== null,
  });

  return null;
}
