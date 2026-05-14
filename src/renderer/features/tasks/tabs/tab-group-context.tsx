import { createContext, useContext } from 'react';
import type { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';

export interface TabGroupContextValue {
  groupId: string;
  tabManager: TabManagerStore;
}

export const TabGroupContext = createContext<TabGroupContextValue | null>(null);

/**
 * Returns the per-pane TabManagerStore and groupId for the enclosing pane.
 * Must be used inside a TabGroupContext.Provider (i.e. within SplitPaneLayout).
 */
export function useTabGroupContext(): TabGroupContextValue {
  const ctx = useContext(TabGroupContext);
  if (!ctx) {
    throw new Error('useTabGroupContext must be used within a TabGroupContext.Provider');
  }
  return ctx;
}
