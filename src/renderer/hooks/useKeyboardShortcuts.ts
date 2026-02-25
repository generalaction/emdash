import { useEffect, useMemo } from 'react';
import type {
  ShortcutConfig,
  GlobalShortcutHandlers,
  ShortcutMapping,
  ShortcutModifier,
  KeyboardSettings,
} from '../types/shortcuts';

// Settings keys for keyboard shortcuts
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

export interface AppShortcut {
  key: string;
  modifier?: ShortcutModifier;
  label: string;
  description: string;
  category: string;
  settingsKey: ShortcutSettingsKey;
  hideFromSettings?: boolean;
}

const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function getPlatformTaskSwitchDefaults(): { next: AppShortcut; prev: AppShortcut } {
  if (isMacPlatform) {
    return {
      next: {
        key: ']',
        modifier: 'cmd',
        label: 'Next Task',
        description: 'Switch to the next task',
        category: 'Navigation',
        settingsKey: 'nextProject',
      },
      prev: {
        key: '[',
        modifier: 'cmd',
        label: 'Previous Task',
        description: 'Switch to the previous task',
        category: 'Navigation',
        settingsKey: 'prevProject',
      },
    };
  }

  return {
    next: {
      key: 'Tab',
      modifier: 'ctrl',
      label: 'Next Task',
      description: 'Switch to the next task',
      category: 'Navigation',
      settingsKey: 'nextProject',
    },
    prev: {
      key: 'Tab',
      modifier: 'ctrl+shift',
      label: 'Previous Task',
      description: 'Switch to the previous task',
      category: 'Navigation',
      settingsKey: 'prevProject',
    },
  };
}

const TASK_SWITCH_SHORTCUTS = getPlatformTaskSwitchDefaults();

export function normalizeShortcutKey(value: string): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'esc' || lower === 'escape') return 'Escape';
  if (lower === 'tab') return 'Tab';
  if (lower === 'arrowleft' || lower === 'left') return 'ArrowLeft';
  if (lower === 'arrowright' || lower === 'right') return 'ArrowRight';
  if (lower === 'arrowup' || lower === 'up') return 'ArrowUp';
  if (lower === 'arrowdown' || lower === 'down') return 'ArrowDown';
  if (trimmed.length === 1) return trimmed.toLowerCase();
  return trimmed;
}

export const APP_SHORTCUTS: Record<string, AppShortcut> = {
  COMMAND_PALETTE: {
    key: 'k',
    modifier: 'cmd',
    label: 'Command Palette',
    description: 'Open the command palette to quickly search and navigate',
    category: 'Navigation',
    settingsKey: 'commandPalette',
  },

  SETTINGS: {
    key: ',',
    modifier: 'cmd',
    label: 'Settings',
    description: 'Open application settings',
    category: 'Navigation',
    settingsKey: 'settings',
  },

  TOGGLE_LEFT_SIDEBAR: {
    key: 'b',
    modifier: 'cmd',
    label: 'Toggle Left Sidebar',
    description: 'Show or hide the left sidebar',
    category: 'View',
    settingsKey: 'toggleLeftSidebar',
  },

  TOGGLE_RIGHT_SIDEBAR: {
    key: '.',
    modifier: 'cmd',
    label: 'Toggle Right Sidebar',
    description: 'Show or hide the right sidebar',
    category: 'View',
    settingsKey: 'toggleRightSidebar',
  },

  TOGGLE_THEME: {
    key: 't',
    modifier: 'cmd',
    label: 'Toggle Theme',
    description: 'Cycle through light, dark navy, and dark black themes',
    category: 'View',
    settingsKey: 'toggleTheme',
  },

  TOGGLE_KANBAN: {
    key: 'p',
    modifier: 'cmd',
    label: 'Toggle Kanban',
    description: 'Show or hide the Kanban board',
    category: 'Navigation',
    settingsKey: 'toggleKanban',
  },

  TOGGLE_EDITOR: {
    key: 'e',
    modifier: 'cmd',
    label: 'Toggle Editor',
    description: 'Show or hide the code editor',
    category: 'View',
    settingsKey: 'toggleEditor',
  },

  CLOSE_MODAL: {
    key: 'Escape',
    modifier: undefined,
    label: 'Close Modal',
    description: 'Close the current modal or dialog',
    category: 'Navigation',
    settingsKey: 'closeModal',
    hideFromSettings: true,
  },

  NEXT_TASK: TASK_SWITCH_SHORTCUTS.next,

  PREV_TASK: TASK_SWITCH_SHORTCUTS.prev,

  NEW_TASK: {
    key: 'n',
    modifier: 'cmd',
    label: 'New Task',
    description: 'Create a new task',
    category: 'Navigation',
    settingsKey: 'newTask',
  },

  NEXT_AGENT: {
    key: 'k',
    modifier: 'cmd+shift',
    label: 'Next Agent',
    description: 'Cycle through agents on a task',
    category: 'Navigation',
    settingsKey: 'nextAgent',
  },

  PREV_AGENT: {
    key: 'j',
    modifier: 'cmd+shift',
    label: 'Previous Agent',
    description: 'Cycle through agents on a task',
    category: 'Navigation',
    settingsKey: 'prevAgent',
  },

  OPEN_IN_EDITOR: {
    key: 'o',
    modifier: 'cmd',
    label: 'Open in Editor',
    description: 'Open the project in the default editor',
    category: 'Navigation',
    settingsKey: 'openInEditor',
  },
};

/**
 * ==============================================================================
 * HELPER FUNCTIONS
 * ==============================================================================
 */

export function formatShortcut(shortcut: ShortcutConfig): string {
  let modifier = '';
  if (shortcut.modifier) {
    switch (shortcut.modifier) {
      case 'cmd':
        modifier = '⌘';
        break;
      case 'option':
        modifier = '⌥';
        break;
      case 'shift':
        modifier = '⇧';
        break;
      case 'alt':
        modifier = 'Alt';
        break;
      case 'ctrl':
        modifier = 'Ctrl';
        break;
      case 'cmd+shift':
        modifier = '⌘⇧';
        break;
      case 'ctrl+shift':
        modifier = 'Ctrl⇧';
        break;
    }
  }

  let key = normalizeShortcutKey(shortcut.key);
  if (key === 'Escape') key = 'Esc';
  else if (key === 'Tab') key = 'Tab';
  else if (key === 'ArrowLeft') key = '←';
  else if (key === 'ArrowRight') key = '→';
  else if (key === 'ArrowUp') key = '↑';
  else if (key === 'ArrowDown') key = '↓';
  else key = key.toUpperCase();

  return modifier ? `${modifier}${key}` : key;
}

export function getShortcutsByCategory(): Record<string, ShortcutConfig[]> {
  const shortcuts = Object.values(APP_SHORTCUTS);
  const grouped: Record<string, ShortcutConfig[]> = {};

  shortcuts.forEach((shortcut) => {
    const category = shortcut.category || 'Other';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(shortcut);
  });

  return grouped;
}

export function hasShortcutConflict(shortcut1: ShortcutConfig, shortcut2: ShortcutConfig): boolean {
  return (
    normalizeShortcutKey(shortcut1.key) === normalizeShortcutKey(shortcut2.key) &&
    shortcut1.modifier === shortcut2.modifier
  );
}

function matchesModifier(modifier: ShortcutModifier | undefined, event: KeyboardEvent): boolean {
  if (!modifier) {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  }

  switch (modifier) {
    case 'cmd':
      // On macOS require the Command key; on other platforms allow Ctrl as the Command equivalent
      // Also ensure shift is NOT pressed (to distinguish from cmd+shift)
      return (
        (isMacPlatform ? event.metaKey : event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      );
    case 'ctrl':
      // Require the Control key without treating Command as equivalent
      return event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    case 'alt':
    case 'option':
      return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
    case 'shift':
      return event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    case 'cmd+shift':
      // Compound modifier: Command + Shift
      return (
        (isMacPlatform ? event.metaKey : event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey
      );
    case 'ctrl+shift':
      return event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    default:
      return false;
  }
}

/**
 * ==============================================================================
 * GLOBAL SHORTCUT HOOK
 * ==============================================================================
 */

/**
 * Get effective shortcut config, applying custom settings if available
 */
function getEffectiveConfig(
  shortcut: AppShortcut,
  customSettings?: KeyboardSettings
): ShortcutConfig {
  const custom = customSettings?.[shortcut.settingsKey];
  if (custom) {
    return {
      key: custom.key,
      modifier: custom.modifier,
      description: shortcut.description,
      category: shortcut.category,
    };
  }
  return {
    key: shortcut.key,
    modifier: shortcut.modifier,
    description: shortcut.description,
    category: shortcut.category,
  };
}

/**
 * Single global keyboard shortcuts hook
 * Call this once in your App component with all handlers
 */
export function useKeyboardShortcuts(handlers: GlobalShortcutHandlers) {
  // Compute effective shortcuts with custom settings applied
  const effectiveShortcuts = useMemo(() => {
    const custom = handlers.customKeyboardSettings;
    return {
      commandPalette: getEffectiveConfig(APP_SHORTCUTS.COMMAND_PALETTE, custom),
      settings: getEffectiveConfig(APP_SHORTCUTS.SETTINGS, custom),
      toggleLeftSidebar: getEffectiveConfig(APP_SHORTCUTS.TOGGLE_LEFT_SIDEBAR, custom),
      toggleRightSidebar: getEffectiveConfig(APP_SHORTCUTS.TOGGLE_RIGHT_SIDEBAR, custom),
      toggleTheme: getEffectiveConfig(APP_SHORTCUTS.TOGGLE_THEME, custom),
      toggleKanban: getEffectiveConfig(APP_SHORTCUTS.TOGGLE_KANBAN, custom),
      toggleEditor: getEffectiveConfig(APP_SHORTCUTS.TOGGLE_EDITOR, custom),
      closeModal: getEffectiveConfig(APP_SHORTCUTS.CLOSE_MODAL, custom),
      nextProject: getEffectiveConfig(APP_SHORTCUTS.NEXT_TASK, custom),
      prevProject: getEffectiveConfig(APP_SHORTCUTS.PREV_TASK, custom),
      newTask: getEffectiveConfig(APP_SHORTCUTS.NEW_TASK, custom),
      nextAgent: getEffectiveConfig(APP_SHORTCUTS.NEXT_AGENT, custom),
      prevAgent: getEffectiveConfig(APP_SHORTCUTS.PREV_AGENT, custom),
      openInEditor: getEffectiveConfig(APP_SHORTCUTS.OPEN_IN_EDITOR, custom),
    };
  }, [handlers.customKeyboardSettings]);

  useEffect(() => {
    // Build dynamic shortcut mappings from config
    const shortcuts: ShortcutMapping[] = [
      {
        config: effectiveShortcuts.commandPalette,
        handler: () => handlers.onToggleCommandPalette?.(),
        priority: 'global',
        isCommandPalette: true,
      },
      {
        config: effectiveShortcuts.settings,
        handler: () => handlers.onOpenSettings?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.toggleLeftSidebar,
        handler: () => handlers.onToggleLeftSidebar?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.toggleRightSidebar,
        handler: () => handlers.onToggleRightSidebar?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.toggleTheme,
        handler: () => handlers.onToggleTheme?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.toggleKanban,
        handler: () => handlers.onToggleKanban?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.toggleEditor,
        handler: () => handlers.onToggleEditor?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.closeModal,
        handler: () => handlers.onCloseModal?.(),
        priority: 'modal',
      },
      {
        config: effectiveShortcuts.nextProject,
        handler: () => handlers.onNextProject?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.prevProject,
        handler: () => handlers.onPrevProject?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.newTask,
        handler: () => handlers.onNewTask?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.nextAgent,
        handler: () => handlers.onNextAgent?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.prevAgent,
        handler: () => handlers.onPrevAgent?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: effectiveShortcuts.openInEditor,
        handler: () => handlers.onOpenInEditor?.(),
        priority: 'global',
        requiresClosed: true,
      },
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = normalizeShortcutKey(event.key);

      // When the user is typing in an editable field (input, textarea,
      // contenteditable), skip most shortcuts to avoid intercepting text
      // input.  On Linux the 'cmd' modifier maps to Ctrl, so shortcuts
      // like Ctrl+B (toggle sidebar) can fire when the OS or an input
      // method reports an unexpected modifier state during normal typing.
      // The command palette toggle is exempt so it remains reachable from
      // any context.
      const target = event.target as HTMLElement;
      const isEditableTarget =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      for (const shortcut of shortcuts) {
        const shortcutKey = normalizeShortcutKey(shortcut.config.key);
        const keyMatches = key === shortcutKey;

        if (!keyMatches) continue;

        // Check modifier requirements precisely (e.g., Cmd ≠ Ctrl on macOS)
        if (!matchesModifier(shortcut.config.modifier, event)) continue;

        // Skip non-command-palette shortcuts when typing in an input
        if (isEditableTarget && !shortcut.isCommandPalette) continue;

        // Command palette is blocking; settings behaves like a page and should
        // not force-close for global shortcuts.
        const isCommandPaletteOpen = Boolean(handlers.isCommandPaletteOpen);
        const hasClosableOverlay = Boolean(
          handlers.isCommandPaletteOpen || handlers.isSettingsOpen
        );

        // Modal-priority shortcuts (like Escape) only work when an overlay is open
        if (shortcut.priority === 'modal' && !hasClosableOverlay) continue;

        // Global shortcuts
        if (shortcut.priority === 'global') {
          // Command palette toggle always works
          if (shortcut.isCommandPalette) {
            event.preventDefault();
            shortcut.handler();
            return;
          }

          // Other shortcuts: if command palette is open and they can close it
          if (isCommandPaletteOpen && shortcut.requiresClosed) {
            event.preventDefault();
            handlers.onCloseModal?.();
            setTimeout(() => shortcut.handler(), 100);
            return;
          }

          // Normal execution when command palette is not open.
          // This keeps settings open while allowing global view shortcuts.
          if (!isCommandPaletteOpen) {
            event.preventDefault();
            shortcut.handler();
            return;
          }
        }

        // Execute modal shortcuts
        if (shortcut.priority === 'modal') {
          event.preventDefault();
          shortcut.handler();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handlers, effectiveShortcuts]);
}
