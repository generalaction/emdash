import React from 'react';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useSidebar } from '../components/ui/sidebar';
import { useKeyboardSettings } from '../contexts/KeyboardSettingsContext';
import { useModalContext } from '../contexts/ModalProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementProvider';
import { useWorkspaceNavigation, useWorkspaceSlots } from '../contexts/WorkspaceNavigationContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useTheme } from '../hooks/useTheme';

const AppKeyboardShortcuts: React.FC = () => {
  const { toggle: toggleLeftSidebar } = useSidebar();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { settings: keyboardSettings } = useKeyboardSettings();
  const { handleNextTask, handlePrevTask, handleNewTask } = useTaskManagementContext();
  const { showModal, activeModalId, closeModal } = useModalContext();
  const { navigate } = useWorkspaceNavigation();
  const { currentView } = useWorkspaceSlots();

  const isCommandPaletteOpen = activeModalId === 'commandPaletteModal';
  const isSettingsOpen = currentView === 'settings';

  useKeyboardShortcuts({
    onToggleCommandPalette: () => showModal('commandPaletteModal', {}),
    onOpenSettings: () => navigate('settings'),
    onToggleLeftSidebar: toggleLeftSidebar,
    onToggleRightSidebar: toggleRightSidebar,
    onToggleTheme: toggleTheme,
    onToggleKanban: () => {},
    onToggleEditor: () => {},
    onNextProject: handleNextTask,
    onPrevProject: handlePrevTask,
    onNewTask: handleNewTask,
    onNextAgent: () =>
      window.dispatchEvent(
        new CustomEvent('emdash:switch-agent', { detail: { direction: 'next' } })
      ),
    onPrevAgent: () =>
      window.dispatchEvent(
        new CustomEvent('emdash:switch-agent', { detail: { direction: 'prev' } })
      ),
    onOpenInEditor: () => {},
    onCloseModal: isCommandPaletteOpen
      ? closeModal
      : isSettingsOpen
        ? () => navigate('home')
        : undefined,
    isCommandPaletteOpen,
    isSettingsOpen,
    customKeyboardSettings: keyboardSettings ?? undefined,
  });

  return null;
};

export default AppKeyboardShortcuts;
