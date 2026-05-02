import { useHotkey } from '@tanstack/react-hotkeys';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
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

/**
 * Mounts global keyboard shortcut handlers for the entire application.
 * Renders nothing — exists only to register useHotkey() calls that are always active.
 * Must be mounted inside all relevant providers (ModalProvider, WorkspaceLayoutContext, etc.).
 */
export function AppKeyboardShortcuts() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const showNewProject = useShowModal('addProjectModal');
  const showCreateTask = useShowModal('taskModal');
  const { toggleLeft, toggleRight } = useWorkspaceLayoutContext();
  const { toggleTheme } = useTheme();
  const { navigate } = useNavigate();
  const commandPaletteHotkey = getEffectiveHotkey('commandPalette', keyboard);
  const settingsHotkey = getEffectiveHotkey('settings', keyboard);
  const toggleLeftSidebarHotkey = getEffectiveHotkey('toggleLeftSidebar', keyboard);
  const toggleRightSidebarHotkey = getEffectiveHotkey('toggleRightSidebar', keyboard);
  const toggleThemeHotkey = getEffectiveHotkey('toggleTheme', keyboard);
  const newProjectHotkey = getEffectiveHotkey('newProject', keyboard);
  const newTaskHotkey = getEffectiveHotkey('newTask', keyboard);

  // Resolve current project context from whichever view is active
  const { currentView, previousView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');
  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;

  useHotkey(
    getHotkeyRegistration('commandPalette', keyboard),
    () => toast({ title: 'CMDK coming soon' }),
    { enabled: commandPaletteHotkey !== null }
  );

  useHotkey(
    getHotkeyRegistration('settings', keyboard),
    () => {
      if (currentView === 'settings') {
        navigate(previousView ?? 'home');
      } else {
        navigate('settings');
      }
    },
    {
      enabled: settingsHotkey !== null,
    }
  );

  useHotkey(
    'Escape',
    () => {
      if (modalStore.isOpen) return;
      navigate(previousView ?? 'home');
    },
    { enabled: currentView === 'settings', ignoreInputs: true }
  );

  useHotkey(getHotkeyRegistration('toggleLeftSidebar', keyboard), () => toggleLeft(), {
    enabled: toggleLeftSidebarHotkey !== null,
  });

  useHotkey(getHotkeyRegistration('toggleRightSidebar', keyboard), () => toggleRight(), {
    enabled: toggleRightSidebarHotkey !== null,
  });

  useHotkey(getHotkeyRegistration('toggleTheme', keyboard), () => toggleTheme(), {
    enabled: toggleThemeHotkey !== null,
  });

  useHotkey(
    getHotkeyRegistration('newProject', keyboard),
    () => showNewProject({ strategy: 'local', mode: 'pick' }),
    { enabled: newProjectHotkey !== null }
  );

  useHotkey(
    getHotkeyRegistration('newTask', keyboard),
    () => {
      if (currentProjectId) showCreateTask({ projectId: currentProjectId });
    },
    { enabled: !!currentProjectId && newTaskHotkey !== null }
  );

  return null;
}
