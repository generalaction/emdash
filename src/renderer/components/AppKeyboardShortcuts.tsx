import React from 'react';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useKeyboardSettings } from '../contexts/KeyboardSettingsContext';

export interface AppKeyboardShortcutsProps {
  showCommandPalette: boolean;
  showSettings: boolean;
  handleToggleCommandPalette: () => void;
  handleOpenSettings: () => void;
  handleCloseCommandPalette: () => void;
  handleCloseSettings: () => void;
  handleToggleKanban: () => void;
  handleToggleEditor: () => void;
  handleNextTask: () => void;
  handlePrevTask: () => void;
  handleNewTask: () => void;
  handleOpenInEditor: () => void;
}

const AppKeyboardShortcuts: React.FC<AppKeyboardShortcutsProps> = ({
  showCommandPalette,
  showSettings,
  handleToggleCommandPalette,
  handleOpenSettings,
  handleCloseCommandPalette,
  handleCloseSettings,
  handleToggleKanban,
  handleToggleEditor,
  handleNextTask,
  handlePrevTask,
  handleNewTask,
  handleOpenInEditor,
}) => {
  const { toggle: toggleLeftSidebar } = useSidebar();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { settings: keyboardSettings } = useKeyboardSettings();

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
    onOpenInEditor: handleOpenInEditor,
    onNextTab: () =>
      window.dispatchEvent(new CustomEvent('emdash:switch-tab', { detail: { direction: 'next' } })),
    onPrevTab: () =>
      window.dispatchEvent(new CustomEvent('emdash:switch-tab', { detail: { direction: 'prev' } })),
    onNewTab: () => window.dispatchEvent(new CustomEvent('emdash:new-tab')),
    onCloseTab: () => window.dispatchEvent(new CustomEvent('emdash:close-tab')),
    onCloseModal: showCommandPalette
      ? handleCloseCommandPalette
      : showSettings
        ? handleCloseSettings
        : undefined,
    isCommandPaletteOpen: showCommandPalette,
    isSettingsOpen: showSettings,
    customKeyboardSettings: keyboardSettings ?? undefined,
  });

  return null;
};

export default AppKeyboardShortcuts;
