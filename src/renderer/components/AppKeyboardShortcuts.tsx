import React from 'react';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useKeyboardSettings } from '../contexts/KeyboardSettingsContext';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import { useModalContext } from '../contexts/ModalProvider';
import { useWorkspaceNavigation, useWorkspaceSlots } from '../contexts/WorkspaceNavigationContext';

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
