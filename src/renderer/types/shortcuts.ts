export type ShortcutModifier =
  | 'cmd'
  | 'ctrl'
  | 'shift'
  | 'alt'
  | 'option'
  | 'cmd+shift'
  | 'ctrl+shift';

export interface ShortcutConfig {
  key: string;
  modifier?: ShortcutModifier;
  description: string;
  category?: string;
}

export type KeyboardShortcut = ShortcutConfig & {
  handler: (event: KeyboardEvent) => void;
  preventDefault?: boolean;
  stopPropagation?: boolean;
};

/**
 * Mapping of shortcuts to their handlers
 */
export interface ShortcutMapping {
  config: ShortcutConfig;
  handler: () => void;
  priority: 'modal' | 'global';
  requiresClosed?: boolean; // Execute after closing modal
}

/**
 * Interface for global keyboard shortcut handlers
 */
export interface GlobalShortcutHandlers {
  // Modals (highest priority - checked first)
  onCloseModal?: () => void;

  // Command Palette
  onToggleCommandPalette?: () => void;

  // Settings
  onOpenSettings?: () => void;

  // Sidebars
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;

  // Theme
  onToggleTheme?: () => void;

  // Kanban
  onToggleKanban?: () => void;

  // Feedback
  onOpenFeedback?: () => void;

  // State checks
  isCommandPaletteOpen?: boolean;
  isSettingsOpen?: boolean;
}
