import type React from 'react';
import type { ShortcutSettingsKey } from '@shared/shortcuts';

/**
 * A single actionable entry in a tab context menu (close, rename, …).
 * Renderer-local type — not part of the engine authoring contract.
 */
export interface TabCommand {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Grouping key for separator placement. */
  group?: 'close' | (string & {});
  /**
   * Hotkey binding. Either a user-configurable settings key (resolved via the
   * shortcut settings system) or a getter returning a raw key string.
   */
  shortcut?: ShortcutSettingsKey | (() => string | undefined);
  /** Hides the command when false (default: always visible). */
  isAvailable?(): boolean;
  run(): void | Promise<void>;
}
