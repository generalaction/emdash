import { useHotkey } from '@tanstack/react-hotkeys';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

/**
 * Mounts global keyboard shortcut handlers for the entire application.
 * Renders nothing — exists only to register useHotkey() calls that are always active.
 * Must be mounted inside all relevant providers (ModalProvider, WorkspaceLayoutContext, etc.).
 */
export function AppKeyboardShortcuts() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const showCmdPalette = useShowModal('commandPaletteModal');
  const showNewProject = useShowModal('addProjectModal');
  const showCreateTask = useShowModal('taskModal');
  const { toggleLeft, toggleRight } = useWorkspaceLayoutContext();
  const { toggleTheme } = useTheme();
  const { navigate } = useNavigate();

  // Resolve current project context from whichever view is active
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');
  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;

  useHotkey(getEffectiveHotkey('commandPalette', keyboard), () => showCmdPalette({}));

  useHotkey(getEffectiveHotkey('settings', keyboard), () => navigate('settings'));

  useHotkey(getEffectiveHotkey('toggleLeftSidebar', keyboard), () => toggleLeft());

  useHotkey(getEffectiveHotkey('toggleRightSidebar', keyboard), () => toggleRight());

  useHotkey(getEffectiveHotkey('toggleTheme', keyboard), () => toggleTheme());

  useHotkey(getEffectiveHotkey('newProject', keyboard), () =>
    showNewProject({ strategy: 'local', mode: 'pick' })
  );

  useHotkey(
    getEffectiveHotkey('newTask', keyboard),
    () => {
      if (currentProjectId) showCreateTask({ projectId: currentProjectId });
    },
    { enabled: !!currentProjectId }
  );

  return null;
}
