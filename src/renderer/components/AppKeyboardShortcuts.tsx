import React from 'react';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useKeyboardSettings } from '../contexts/KeyboardSettingsContext';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';

export interface AppKeyboardShortcutsProps {
  showCommandPalette: boolean;
  showSettings: boolean;
  showBrowser: boolean;
  showDiffViewer: boolean;
  showEditor: boolean;
  showKanban: boolean;
  handleToggleCommandPalette: () => void;
  handleOpenSettings: () => void;
  handleCloseCommandPalette: () => void;
  handleCloseSettings: () => void;
  handleCloseBrowser: () => void;
  handleCloseDiffViewer: () => void;
  handleCloseEditor: () => void;
  handleCloseKanban: () => void;
  handleToggleKanban: () => void;
  handleToggleEditor: () => void;
  handleOpenInEditor: () => void;
  handleNavigateBack: () => void;
  handleNavigateForward: () => void;
}

const AppKeyboardShortcuts: React.FC<AppKeyboardShortcutsProps> = ({
  showCommandPalette,
  showSettings,
  showBrowser,
  showDiffViewer,
  showEditor,
  showKanban,
  handleToggleCommandPalette,
  handleOpenSettings,
  handleCloseCommandPalette,
  handleCloseSettings,
  handleCloseBrowser,
  handleCloseDiffViewer,
  handleCloseEditor,
  handleCloseKanban,
  handleToggleKanban,
  handleToggleEditor,
  handleOpenInEditor,
  handleNavigateBack,
  handleNavigateForward,
}) => {
  const { toggle: toggleLeftSidebar } = useSidebar();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { settings: keyboardSettings } = useKeyboardSettings();
  const { handleNextTask, handlePrevTask, handleNewTask } = useTaskManagementContext();

  useKeyboardShortcuts({
    onToggleCommandPalette: handleToggleCommandPalette,
    onOpenSettings: handleOpenSettings,
    onToggleLeftSidebar: toggleLeftSidebar,
    onToggleRightSidebar: toggleRightSidebar,
    onToggleTheme: toggleTheme,
    onToggleKanban: handleToggleKanban,
    onToggleEditor: handleToggleEditor,
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
    onSelectAgentTab: (tabIndex) =>
      window.dispatchEvent(new CustomEvent('emdash:select-agent-tab', { detail: { tabIndex } })),
    onOpenInEditor: handleOpenInEditor,
    onNavigateBack: handleNavigateBack,
    onNavigateForward: handleNavigateForward,
    onCloseModal: (
      [
        [showCommandPalette, handleCloseCommandPalette],
        [showSettings, handleCloseSettings],
        [showBrowser, handleCloseBrowser],
        [showDiffViewer, handleCloseDiffViewer],
        [showEditor, handleCloseEditor],
        [showKanban, handleCloseKanban],
      ] as const
    ).find(([open]) => open)?.[1],
    isCommandPaletteOpen: showCommandPalette,
    isSettingsOpen: showSettings,
    isBrowserOpen: showBrowser,
    isDiffViewerOpen: showDiffViewer,
    isEditorOpen: showEditor,
    isKanbanOpen: showKanban,
    customKeyboardSettings: keyboardSettings ?? undefined,
  });

  return null;
};

export default AppKeyboardShortcuts;
