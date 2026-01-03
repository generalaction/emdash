import { useEffect, useMemo } from 'react';
import type {
  ShortcutConfig,
  GlobalShortcutHandlers,
  ShortcutMapping,
  ShortcutModifier,
} from '../types/shortcuts';

export const APP_SHORTCUTS = {
  // Command Palette
  COMMAND_PALETTE: {
    key: 'k',
    modifier: 'cmd' as const,
    description: 'Open command palette',
    category: 'Navigation',
  },

  // Settings & Config
  SETTINGS: {
    key: ',',
    modifier: 'cmd' as const,
    description: 'Open settings',
    category: 'Navigation',
  },

  // Sidebar Controls
  TOGGLE_LEFT_SIDEBAR: {
    key: 'b',
    modifier: 'cmd' as const,
    description: 'Toggle left sidebar',
    category: 'View',
  },

  TOGGLE_RIGHT_SIDEBAR: {
    key: '.',
    modifier: 'cmd' as const,
    description: 'Toggle right sidebar',
    category: 'View',
  },

  // Theme
  TOGGLE_THEME: {
    key: 't',
    modifier: 'cmd' as const,
    description: 'Toggle theme',
    category: 'View',
  },

  // Kanban
  TOGGLE_KANBAN: {
    key: 'p',
    modifier: 'cmd' as const,
    description: 'Toggle Kanban',
    category: 'Navigation',
  },

  // Modal Controls
  CLOSE_MODAL: {
    key: 'Escape',
    description: 'Close modal/dialog',
    category: 'Navigation',
  },
} as const;

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

  const key = shortcut.key === 'Escape' ? 'Esc' : shortcut.key.toUpperCase();

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
 * Single global keyboard shortcuts hook
 * Call this once in your App component with all handlers
 */
export function useKeyboardShortcuts(handlers: GlobalShortcutHandlers) {
  // Compute effective command palette shortcut (custom or default)
  const commandPaletteConfig = useMemo((): ShortcutConfig => {
    const custom = handlers.customKeyboardSettings?.commandPalette;
    if (custom) {
      return {
        key: custom.key,
        modifier: custom.modifier,
        description: APP_SHORTCUTS.COMMAND_PALETTE.description,
        category: APP_SHORTCUTS.COMMAND_PALETTE.category,
      };
    }
    return APP_SHORTCUTS.COMMAND_PALETTE;
  }, [handlers.customKeyboardSettings?.commandPalette]);

  useEffect(() => {
    // Build dynamic shortcut mappings from config
    const shortcuts: ShortcutMapping[] = [
      {
        config: commandPaletteConfig,
        handler: () => handlers.onToggleCommandPalette?.(),
        priority: 'global',
      },
      {
        config: APP_SHORTCUTS.SETTINGS,
        handler: () => handlers.onOpenSettings?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: APP_SHORTCUTS.TOGGLE_LEFT_SIDEBAR,
        handler: () => handlers.onToggleLeftSidebar?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: APP_SHORTCUTS.TOGGLE_RIGHT_SIDEBAR,
        handler: () => handlers.onToggleRightSidebar?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: APP_SHORTCUTS.TOGGLE_THEME,
        handler: () => handlers.onToggleTheme?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: APP_SHORTCUTS.TOGGLE_KANBAN,
        handler: () => handlers.onToggleKanban?.(),
        priority: 'global',
        requiresClosed: true,
      },
      {
        config: APP_SHORTCUTS.CLOSE_MODAL,
        handler: () => handlers.onCloseModal?.(),
        priority: 'modal',
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
          if (shortcut.config === commandPaletteConfig) {
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
  }, [handlers, commandPaletteConfig]);
}
