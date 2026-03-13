/**
 * APP_SHORTCUTS — central registry of keyboard shortcut metadata.
 *
 * `defaultHotkey` uses TanStack Hotkeys string format (e.g. 'Mod+K').
 * Defaults are resolved here in the renderer rather than in schema.ts because
 * some are platform-specific.
 *
 * All event handling is done in AppKeyboardShortcuts.tsx via useHotkey().
 */
import type { Hotkey } from '@tanstack/react-hotkeys';

export type ShortcutSettingsKey =
  | 'commandPalette'
  | 'settings'
  | 'toggleLeftSidebar'
  | 'toggleRightSidebar'
  | 'toggleTheme'
  | 'toggleKanban'
  | 'toggleEditor'
  | 'closeModal'
  | 'nextProject'
  | 'prevProject'
  | 'newTask'
  | 'nextAgent'
  | 'prevAgent'
  | 'openInEditor';

export interface AppShortcutDef {
  defaultHotkey: string;
  label: string;
  description: string;
  category: string;
  hideFromSettings?: boolean;
}

export const APP_SHORTCUTS: Record<ShortcutSettingsKey, AppShortcutDef> = {
  commandPalette: {
    defaultHotkey: 'Mod+K',
    label: 'Command Palette',
    description: 'Open the command palette to quickly search and navigate',
    category: 'Navigation',
  },
  settings: {
    defaultHotkey: 'Mod+,',
    label: 'Settings',
    description: 'Open application settings',
    category: 'Navigation',
  },
  toggleLeftSidebar: {
    defaultHotkey: 'Mod+B',
    label: 'Toggle Left Sidebar',
    description: 'Show or hide the left sidebar',
    category: 'View',
  },
  toggleRightSidebar: {
    defaultHotkey: 'Mod+.',
    label: 'Toggle Right Sidebar',
    description: 'Show or hide the right sidebar',
    category: 'View',
  },
  toggleTheme: {
    defaultHotkey: 'Mod+T',
    label: 'Toggle Theme',
    description: 'Cycle through light, dark navy, and dark black themes',
    category: 'View',
  },
  toggleKanban: {
    defaultHotkey: 'Mod+P',
    label: 'Toggle Kanban',
    description: 'Show or hide the Kanban board',
    category: 'Navigation',
  },
  toggleEditor: {
    defaultHotkey: 'Mod+Shift+E',
    label: 'Toggle Editor',
    description: 'Show or hide the code editor',
    category: 'View',
  },
  closeModal: {
    defaultHotkey: 'Escape',
    label: 'Close Modal',
    description: 'Close the current modal or dialog',
    category: 'Navigation',
    hideFromSettings: true,
  },
  nextProject: {
    defaultHotkey: 'Mod+]',
    label: 'Next Task',
    description: 'Switch to the next task',
    category: 'Navigation',
  },
  prevProject: {
    defaultHotkey: 'Mod+[',
    label: 'Previous Task',
    description: 'Switch to the previous task',
    category: 'Navigation',
  },
  newTask: {
    defaultHotkey: 'Mod+N',
    label: 'New Task',
    description: 'Create a new task',
    category: 'Navigation',
  },
  nextAgent: {
    defaultHotkey: 'Mod+Shift+K',
    label: 'Next Agent',
    description: 'Cycle through agents on a task',
    category: 'Navigation',
  },
  prevAgent: {
    defaultHotkey: 'Mod+Shift+J',
    label: 'Previous Agent',
    description: 'Cycle through agents on a task',
    category: 'Navigation',
  },
  openInEditor: {
    defaultHotkey: 'Mod+O',
    label: 'Open in Editor',
    description: 'Open the project in the default editor',
    category: 'Navigation',
  },
};

/**
 * Returns the user's stored hotkey for an action, or the default if none is stored.
 * Cast to `Hotkey` since the values are always valid hotkey strings at runtime.
 */
export function getEffectiveHotkey(
  key: ShortcutSettingsKey,
  custom?: Partial<Record<ShortcutSettingsKey, string>>
): Hotkey {
  return (custom?.[key] ?? APP_SHORTCUTS[key].defaultHotkey) as Hotkey;
}
