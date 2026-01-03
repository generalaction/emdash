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
  handleNextTask: () => void;
  handlePrevTask: () => void;
}

const AppKeyboardShortcuts: React.FC<AppKeyboardShortcutsProps> = ({
  showCommandPalette,
  showSettings,
  handleToggleCommandPalette,
  handleOpenSettings,
  handleCloseCommandPalette,
  handleCloseSettings,
  handleToggleKanban,
  handleNextTask,
  handlePrevTask,
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
    onNextProject: handleNextTask,
    onPrevProject: handlePrevTask,
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
