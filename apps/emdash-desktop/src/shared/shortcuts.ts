/**
 * APP_SHORTCUTS — central registry of keyboard shortcut metadata.
 *
 * `defaultHotkey` uses TanStack Hotkeys string format (e.g. 'Mod+K'), or a
 * factory function that is evaluated at call-time so defaults can vary by OS
 * or keyboard layout.
 */

export interface AppShortcutDef {
  defaultHotkey?: string | (() => string);
  label: string;
  description: string;
  category: string;
  hideFromSettings?: boolean;
  conflictBehavior?: 'prevent' | 'allow';
}

export function resolveDefaultHotkey(def: AppShortcutDef): string | undefined {
  return typeof def.defaultHotkey === 'function' ? def.defaultHotkey() : def.defaultHotkey;
}

export type ShortcutInput = {
  type?: string;
  key: string;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  control?: boolean;
};

export type ParsedShortcut = {
  key: string;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  control: boolean;
};

export function parseShortcutHotkey(shortcut: string): ParsedShortcut | null {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const modifiers = { shift: false, alt: false, meta: false, control: false };
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'shift':
        modifiers.shift = true;
        break;
      case 'alt':
      case 'option':
        modifiers.alt = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        modifiers.meta = true;
        break;
      case 'ctrl':
      case 'control':
        modifiers.control = true;
        break;
      case 'mod':
        if (process.platform === 'darwin') modifiers.meta = true;
        else modifiers.control = true;
        break;
      default:
        return null;
    }
  }
  return { key: normalizeShortcutKey(key), ...modifiers };
}

export function isShortcutInput(input: ShortcutInput, shortcut: string | null): boolean {
  if (shortcut === null) return false;
  const parsed = parseShortcutHotkey(shortcut);
  if (!parsed) return false;
  return (
    (input.type === undefined || input.type === 'keyDown') &&
    normalizeShortcutKey(input.key) === parsed.key &&
    Boolean(input.shift) === parsed.shift &&
    Boolean(input.alt) === parsed.alt &&
    Boolean(input.meta) === parsed.meta &&
    Boolean(input.control) === parsed.control
  );
}

function normalizeShortcutKey(key: string): string {
  return key.toLowerCase();
}

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
    description: 'Open application settings',
    category: 'Navigation',
  },
  library: {
    defaultHotkey: 'Mod+L',
    label: 'Library',
    description: 'Open the Library',
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
  closeModal: {
    defaultHotkey: 'Escape',
    label: 'Close Modal',
    description: 'Close the current modal or dialog',
    category: 'Navigation',
    hideFromSettings: true,
  },
  newTask: {
    defaultHotkey: 'Mod+N',
    label: 'New Task',
    description: 'Create a new task',
    category: 'Navigation',
  },
  deleteSelectedTasks: {
    defaultHotkey: 'Mod+Backspace',
    label: 'Delete Selected Tasks',
    description: 'Delete the selected tasks',
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
  sidebarChanges: {
    defaultHotkey: 'Mod+Shift+1',
    label: 'View Changes',
    description: 'Open the right sidebar to the Changes panel',
    category: 'Task View',
  },
  sidebarConversations: {
    defaultHotkey: 'Mod+Shift+3',
    label: 'View Conversations',
    description: 'Open the right sidebar to the Conversations panel',
    category: 'Task View',
  },
  sidebarFiles: {
    defaultHotkey: 'Mod+Shift+2',
    label: 'View Files',
    description: 'Open the right sidebar to the Files panel',
    category: 'Task View',
  },
  tabNext: {
    defaultHotkey: 'Mod+Alt+ArrowRight',
    label: 'Next Tab',
    description: 'Switch to the next tab',
    category: 'Tab Navigation',
    conflictBehavior: 'allow',
  },
  tabPrev: {
    defaultHotkey: 'Mod+Alt+ArrowLeft',
    label: 'Previous Tab',
    description: 'Switch to the previous tab',
    category: 'Tab Navigation',
    conflictBehavior: 'allow',
  },
  tabClose: {
    defaultHotkey: 'Mod+W',
    label: 'Close Tab',
    description: 'Close the active tab',
    category: 'Tab Navigation',
    conflictBehavior: 'allow',
  },
  newConversation: {
    defaultHotkey: 'Mod+T',
    label: 'New Conversation',
    description: 'Create a new conversation in the current task',
    category: 'Task View',
  },
  newConversationSplitRight: {
    defaultHotkey: 'Mod+D',
    label: 'New Conversation in Right Split',
    description: 'Create a new conversation in a split pane to the right',
    category: 'Task View',
  },
  newTerminal: {
    defaultHotkey: 'Mod+Shift+T',
    label: 'New Terminal',
    description: 'Create a new terminal in the current task',
    category: 'Task View',
  },
  openBrowser: {
    defaultHotkey: 'Mod+Shift+B',
    label: 'Open Browser',
    description: 'Open an in-app browser in the current task',
    category: 'Task View',
  },
  browserCopyUrl: {
    defaultHotkey: 'Mod+Shift+C',
    label: 'Copy Browser URL',
    description: 'Copy the current in-app browser URL',
    category: 'Task View',
  },
  browserFind: {
    defaultHotkey: 'Mod+F',
    label: 'Find in Browser Page',
    description: 'Search within the active in-app browser page',
    category: 'Task View',
  },
  toggleTerminalDrawer: {
    defaultHotkey: 'Mod+J',
    label: 'Toggle Terminal Drawer',
    description: 'Show or hide the terminal drawer',
    category: 'Task View',
  },
  confirm: {
    defaultHotkey: 'Mod+Enter',
    label: 'Confirm',
    description: 'Confirm the current dialog action',
    category: 'Navigation',
  },
  navigateBack: {
    defaultHotkey: 'Mod+[',
    label: 'Go Back',
    description: 'Navigate to the previous location',
    category: 'Navigation',
  },
  navigateForward: {
    defaultHotkey: 'Mod+]',
    label: 'Go Forward',
    description: 'Navigate to the next location',
    category: 'Navigation',
  },
  splitPane: {
    defaultHotkey: 'Mod+\\',
    label: 'Split Pane',
    description: 'Move the active tab to a new pane on the right',
    category: 'Tab Navigation',
    conflictBehavior: 'allow',
  },
});

export type ShortcutSettingsKey = keyof typeof APP_SHORTCUTS;
