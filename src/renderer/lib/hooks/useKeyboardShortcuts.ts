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

export interface AppShortcutDef {
  defaultHotkey: string;
  label: string;
  description: string;
  category: string;
  hideFromSettings?: boolean;
}

type ShortcutOverrides = Partial<Record<ShortcutSettingsKey, string | null>>;

/**
 * Preserves literal key types for `keyof` inference while widening each value
 * to the full `AppShortcutDef` interface (so optional fields like
 * `hideFromSettings` are accessible on every entry without a union problem).
 */
function defineShortcuts<T extends Record<string, AppShortcutDef>>(
  shortcuts: T
): Record<keyof T, AppShortcutDef> {
  return shortcuts as Record<keyof T, AppShortcutDef>;
}

export const APP_SHORTCUTS = defineShortcuts({
  commandPalette: {
    defaultHotkey: 'Mod+K',
    label: 'Command Palette',
    description: 'Open the command palette to quickly search and navigate',
    category: 'Navigation',
  },
  settings: {
    defaultHotkey: 'Mod+,',
    label: 'Settings',
    description: 'Open or close application settings',
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
  newProject: {
    defaultHotkey: 'Mod+Shift+N',
    label: 'New Project',
    description: 'Create a new project',
    category: 'Navigation',
  },
  openInEditor: {
    defaultHotkey: 'Mod+O',
    label: 'Open in Editor',
    description: 'Open the project in the default editor',
    category: 'Navigation',
  },
  taskViewAgents: {
    defaultHotkey: 'Mod+Shift+1',
    label: 'Conversations view',
    description: 'Switch to the conversations view in the task panel',
    category: 'Task View',
  },
  taskViewDiff: {
    defaultHotkey: 'Mod+Shift+2',
    label: 'Diff view',
    description: 'Switch to the diff view in the task panel',
    category: 'Task View',
  },
  taskViewEditor: {
    defaultHotkey: 'Mod+Shift+3',
    label: 'Editor view',
    description: 'Switch to the editor view in the task panel',
    category: 'Task View',
  },
  tabNext: {
    defaultHotkey: 'Mod+Alt+ArrowRight',
    label: 'Next Tab',
    description: 'Switch to the next tab',
    category: 'Tab Navigation',
  },
  tabPrev: {
    defaultHotkey: 'Mod+Alt+ArrowLeft',
    label: 'Previous Tab',
    description: 'Switch to the previous tab',
    category: 'Tab Navigation',
  },
  tabClose: {
    defaultHotkey: 'Mod+W',
    label: 'Close Tab',
    description: 'Close the active tab',
    category: 'Tab Navigation',
  },
  newConversation: {
    defaultHotkey: 'Mod+Shift+C',
    label: 'New Conversation',
    description: 'Create a new conversation in the current task',
    category: 'Task View',
  },
  newTerminal: {
    defaultHotkey: 'Mod+Shift+T',
    label: 'New Terminal',
    description: 'Create a new terminal in the current task',
    category: 'Task View',
  },
  confirm: {
    defaultHotkey: 'Mod+Enter',
    label: 'Confirm',
    description: 'Confirm the current dialog action',
    category: 'Navigation',
  },
});

/** All valid shortcut keys — inferred directly from the registry, never redeclared. */
export type ShortcutSettingsKey = keyof typeof APP_SHORTCUTS;

/**
 * Returns the currently assigned hotkey for an action.
 * - `undefined` override -> falls back to default
 * - `null` override -> unassigned (disabled)
 */
export function getEffectiveHotkey(
  key: ShortcutSettingsKey,
  custom?: ShortcutOverrides
): Hotkey | null {
  const configured = custom?.[key];
  if (configured === null) return null;
  return (configured ?? APP_SHORTCUTS[key].defaultHotkey) as Hotkey;
}

/**
 * Always returns a valid hotkey string for hook registration.
 * Pair this with `getEffectiveHotkey(...) !== null` in `enabled`.
 */
export function getHotkeyRegistration(
  key: ShortcutSettingsKey,
  custom?: ShortcutOverrides
): Hotkey {
  return (getEffectiveHotkey(key, custom) ?? APP_SHORTCUTS[key].defaultHotkey) as Hotkey;
}
