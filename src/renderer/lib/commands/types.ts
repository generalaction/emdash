import type { ShortcutSettingsKey } from '@renderer/lib/hooks/useKeyboardShortcuts';

export interface AppCommand {
  id: string;
  label: string;
  description?: string;
  /** Links to APP_SHORTCUTS for hotkey binding and display. */
  shortcutKey?: ShortcutSettingsKey;
  /** Display group in the command palette (e.g. 'Conversations', 'Panel', 'Tabs'). */
  group?: string;
  /**
   * When false the command is visible in the palette but not executable and
   * the hotkey dispatcher skips it, falling through to the next scope.
   * Defaults to true when omitted.
   */
  enabled?: boolean;
  /**
   * When true the command is excluded from the command palette UI but still
   * dispatched by the hotkey system. Use for navigation shortcuts that are
   * handled by dedicated UI controls and would be redundant in the palette.
   */
  hideFromPalette?: boolean;
  execute: () => void;
}

export interface CommandProvider {
  scopeId: ScopeId;
  /**
   * Called inside commandRegistry's @computed activeCommands — any MobX
   * observable read here is automatically tracked and causes activeCommands
   * to recompute when it changes.
   */
  getCommands(): AppCommand[];
}

/**
 * Higher numeric value = more specific (innermost) scope.
 * Dispatch walks from highest to lowest and calls the first enabled handler.
 */
export const SCOPE_LEVELS = {
  app: 0,
  project: 1,
  task: 2,
  'task-sub': 3,
} as const;

export type ScopeId = keyof typeof SCOPE_LEVELS;
