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
  | 'closeModal'
  | 'nextProject'
  | 'prevProject'
  | 'newTask';

export interface AppShortcut {
  key: string;
  modifier?: ShortcutModifier;
  label: string;
  description: string;
  category: string;
  settingsKey: ShortcutSettingsKey;
  hideFromSettings?: boolean;
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

  CLOSE_MODAL: {
    key: 'Escape',
    modifier: undefined,
    label: 'Close Modal',
    description: 'Close the current modal or dialog',
    category: 'Navigation',
    settingsKey: 'closeModal',
    hideFromSettings: true,
  },

  NEXT_TASK: {
    key: 'ArrowRight',
    modifier: 'cmd',
    label: 'Next Task',
    description: 'Switch to the next task',
    category: 'Navigation',
    settingsKey: 'nextProject',
  },

  PREV_TASK: {
    key: 'ArrowLeft',
    modifier: 'cmd',
    label: 'Previous Task',
    description: 'Switch to the previous task',
    category: 'Navigation',
    settingsKey: 'prevProject',
  },

  NEW_TASK: {
    key: 'n',
    modifier: 'cmd',
    label: 'New Task',
    description: 'Create a new task',
    category: 'Navigation',
    settingsKey: 'newTask',
  },
};

/**
 * ==============================================================================
 * HELPER FUNCTIONS
 * ==============================================================================
 */

export function formatShortcut(shortcut: ShortcutConfig): string {
  const modifier = shortcut.modifier
    ? shortcut.modifier === 'cmd'
      ? '⌘'
      : shortcut.modifier === 'option'
        ? '⌥'
        : shortcut.modifier === 'shift'
          ? '⇧'
          : shortcut.modifier === 'alt'
            ? 'Alt'
            : 'Ctrl'
    : '';

  let key = shortcut.key;
  if (key === 'Escape') key = 'Esc';
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
    shortcut1.key.toLowerCase() === shortcut2.key.toLowerCase() &&
    shortcut1.modifier === shortcut2.modifier
  );
}

const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function matchesModifier(modifier: ShortcutModifier | undefined, event: KeyboardEvent): boolean {
  if (!modifier) {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  }

  switch (modifier) {
    case 'cmd':
      // On macOS require the Command key; on other platforms allow Ctrl as the Command equivalent
      return isMacPlatform ? event.metaKey : event.metaKey || event.ctrlKey;
    case 'ctrl':
      // Require the Control key without treating Command as equivalent
      return event.ctrlKey && !event.metaKey;
    case 'alt':
    case 'option':
      return event.altKey;
    case 'shift':
      return event.shiftKey;
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
      closeModal: getEffectiveConfig(APP_SHORTCUTS.CLOSE_MODAL, custom),
      nextProject: getEffectiveConfig(APP_SHORTCUTS.NEXT_TASK, custom),
      prevProject: getEffectiveConfig(APP_SHORTCUTS.PREV_TASK, custom),
      newTask: getEffectiveConfig(APP_SHORTCUTS.NEW_TASK, custom),
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
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      for (const shortcut of shortcuts) {
        const shortcutKey = shortcut.config.key.toLowerCase();
        const keyMatches = key === shortcutKey;

        if (!keyMatches) continue;

        // Check modifier requirements precisely (e.g., Cmd ≠ Ctrl on macOS)
        if (!matchesModifier(shortcut.config.modifier, event)) continue;

        // Handle priority and modal state
        const isModalOpen = handlers.isCommandPaletteOpen || handlers.isSettingsOpen;

        // Modal-priority shortcuts (like Escape) only work when modal is open
        if (shortcut.priority === 'modal' && !isModalOpen) continue;

        // Global shortcuts
        if (shortcut.priority === 'global') {
          // Command palette toggle always works
          if (shortcut.isCommandPalette) {
            event.preventDefault();
            shortcut.handler();
            return;
          }

          // Other shortcuts: if modal is open and they can close it
          if (isModalOpen && shortcut.requiresClosed) {
            event.preventDefault();
            handlers.onCloseModal?.();
            setTimeout(() => shortcut.handler(), 100);
            return;
          }

          // Normal execution when no modal is open
          if (!isModalOpen) {
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers, effectiveShortcuts]);
}
