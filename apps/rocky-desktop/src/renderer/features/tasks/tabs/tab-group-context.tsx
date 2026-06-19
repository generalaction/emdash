import { createContext, useContext, type ReactNode } from 'react';
import { EditorProvider } from '@renderer/features/tasks/editor/editor-provider';
import type { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import type { TabGroupEntry } from './tab-group-manager-store';

export interface TabGroupContextValue {
  groupId: string;
  tabManager: TabManagerStore;
}

export const TabGroupContext = createContext<TabGroupContextValue | null>(null);

/**
 * Returns the per-pane TabManagerStore and groupId for the enclosing pane.
 * Must be used inside a TabGroupProvider (i.e. within SplitPaneLayout).
 */
export function useTabGroupContext(): TabGroupContextValue {
  const ctx = useContext(TabGroupContext);
  if (!ctx) {
    throw new Error('useTabGroupContext must be used within a TabGroupProvider');
  }
  return ctx;
}

interface TabGroupProviderProps {
  group: TabGroupEntry;
  taskId: string;
  projectId: string;
  children: ReactNode;
}

/**
 * Wraps a single pane with its TabGroupContext value and a per-pane EditorProvider.
 * Use this in SplitPaneLayout instead of nesting TabGroupContext.Provider and
 * EditorProvider manually.
 */
export function TabGroupProvider({ group, taskId, projectId, children }: TabGroupProviderProps) {
  return (
    <TabGroupContext.Provider value={{ groupId: group.groupId, tabManager: group.tabManager }}>
      <EditorProvider taskId={taskId} projectId={projectId}>
        {children}
      </EditorProvider>
    </TabGroupContext.Provider>
  );
}
