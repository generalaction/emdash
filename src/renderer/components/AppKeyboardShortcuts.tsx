import React from 'react';
import { useSidebar } from '../components/ui/sidebar';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

export interface AppKeyboardShortcutsProps {
  showCommandPalette: boolean;
  showSettings: boolean;
  handleToggleCommandPalette: () => void;
  handleOpenSettings: () => void;
  handleCloseCommandPalette: () => void;
  handleCloseSettings: () => void;
}

const AppKeyboardShortcuts: React.FC<AppKeyboardShortcutsProps> = ({
  showCommandPalette,
  showSettings,
  handleToggleCommandPalette,
  handleOpenSettings,
  handleCloseCommandPalette,
  handleCloseSettings,
}) => {
  const { toggle: toggleLeftSidebar } = useSidebar();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();

  useKeyboardShortcuts({
    onToggleCommandPalette: handleToggleCommandPalette,
    onOpenSettings: handleOpenSettings,
    onToggleLeftSidebar: toggleLeftSidebar,
    onToggleRightSidebar: toggleRightSidebar,
    onToggleTheme: toggleTheme,
    onCloseModal: showCommandPalette
      ? handleCloseCommandPalette
      : showSettings
        ? handleCloseSettings
        : undefined,
    isCommandPaletteOpen: showCommandPalette,
    isSettingsOpen: showSettings,
  });

  return null;
};

export default AppKeyboardShortcuts;
