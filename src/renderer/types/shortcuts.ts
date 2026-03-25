export type ShortcutModifier =
  | 'cmd'
  | 'ctrl'
  | 'shift'
  | 'alt'
  | 'option'
  | 'cmd+shift'
  | 'ctrl+shift';

export interface ShortcutBinding {
  key: string;
  modifier: ShortcutModifier;
}

export type KeyboardShortcutBinding = ShortcutBinding | null;

export interface KeyboardSettings {
  commandPalette?: KeyboardShortcutBinding;
  settings?: KeyboardShortcutBinding;
  toggleLeftSidebar?: KeyboardShortcutBinding;
  toggleRightSidebar?: KeyboardShortcutBinding;
  toggleTheme?: KeyboardShortcutBinding;
  toggleKanban?: KeyboardShortcutBinding;
  toggleEditor?: KeyboardShortcutBinding;
  closeModal?: KeyboardShortcutBinding;
  nextProject?: KeyboardShortcutBinding;
  prevProject?: KeyboardShortcutBinding;
  newTask?: KeyboardShortcutBinding;
  nextAgent?: KeyboardShortcutBinding;
  prevAgent?: KeyboardShortcutBinding;
  newAgent?: KeyboardShortcutBinding;
  openInEditor?: KeyboardShortcutBinding;
}

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
  requiresClosed?: boolean;
  isCommandPalette?: boolean;
  allowInInput?: boolean;
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

  // Editor
  onToggleEditor?: () => void;

  // Project navigation
  onNextProject?: () => void;
  onPrevProject?: () => void;

  // Task creation
  onNewTask?: () => void;

  // Agent switching (within same task)
  onNextAgent?: () => void;
  onPrevAgent?: () => void;
  onNewAgent?: () => void;
  onSelectAgentTab?: (tabIndex: number) => void;

  // Open in editor
  onOpenInEditor?: () => void;

  // State checks
  isCommandPaletteOpen?: boolean;
  isSettingsOpen?: boolean;
  isBrowserOpen?: boolean;
  isDiffViewerOpen?: boolean;
  isEditorOpen?: boolean;
  isKanbanOpen?: boolean;

  // Custom keyboard settings
  customKeyboardSettings?: KeyboardSettings;
}
