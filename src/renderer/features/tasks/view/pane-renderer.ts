import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';

/** The top-level rendering mode for a single pane. */
export type PaneRenderer =
  | { kind: 'pty-agent' }
  | { kind: 'file'; tab: FileTabStore }
  | { kind: 'file-diff'; tab: DiffTabStore };

/**
 * Derives the active pane renderer from the tab manager's current state.
 * Returns null when the pane has no open tabs.
 */
export function resolvePaneRenderer(tabManager: TabManagerStore): PaneRenderer | null {
  if (tabManager.resolvedTabs.length === 0) return null;
  const desc = tabManager.activeDescriptor;
  if (!desc) return null;
  if (desc.kind === 'diff') return { kind: 'file-diff', tab: desc };
  if (desc.kind === 'file') return { kind: 'file', tab: desc };
  return { kind: 'pty-agent' };
}
