import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';

/** The top-level rendering mode for a single pane. */
export type PaneRenderer =
  | { kind: 'pty-agent' }
  | { kind: 'browser'; browserId: string }
  | { kind: 'file'; tab: FileTabStore }
  | { kind: 'file-diff'; tab: DiffTabStore };

/**
 * Derives the active pane renderer from the tab manager's current state.
 * Returns null when the pane has no open tabs.
 *
 * Uses resolvedTabs as the single source of truth so that conversation tabs
 * whose ConversationStore is not yet available are excluded — preventing
 * ConversationsPanel from being shown with no active conversation.
 */
export function resolvePaneRenderer(tabManager: TabManagerStore): PaneRenderer | null {
  const resolvedTabs = tabManager.resolvedTabs;
  if (resolvedTabs.length === 0) return null;
  // Fall back to the first resolved tab when no tab is marked active (e.g. the
  // raw activeTabId points to a conversation entry that was filtered out).
  const activeTab = resolvedTabs.find((t) => t.isActive) ?? resolvedTabs[0];
  if (activeTab.kind === 'diff') {
    const entry = tabManager.entries.get(activeTab.tabId);
    if (entry?.kind !== 'diff') return null;
    return { kind: 'file-diff', tab: entry };
  }
  if (activeTab.kind === 'file') {
    const entry = tabManager.entries.get(activeTab.tabId);
    if (entry?.kind !== 'file') return null;
    return { kind: 'file', tab: entry };
  }
  if (activeTab.kind === 'browser') {
    return { kind: 'browser', browserId: activeTab.browserId };
  }
  return { kind: 'pty-agent' };
}
