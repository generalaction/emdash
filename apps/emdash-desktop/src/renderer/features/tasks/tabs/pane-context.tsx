import { createContext, useContext, type ReactNode } from 'react';
import { EditorProvider } from '@renderer/features/tasks/editor/editor-provider';
import type { Pane } from './pane-layout-store';
import type { PaneStore } from './pane-store';

export interface PaneContextValue {
  paneId: string;
  pane: PaneStore;
  /** True when this pane is the focused pane in the main region. */
  isFocusedPane: boolean;
}

export const PaneContext = createContext<PaneContextValue | null>(null);

/**
 * Returns the per-pane PaneStore and paneId for the enclosing pane.
 * Must be used inside a PaneProvider (i.e. within SplitPaneLayout).
 */
export function usePaneContext(): PaneContextValue {
  const ctx = useContext(PaneContext);
  if (!ctx) {
    throw new Error('usePaneContext must be used within a PaneProvider');
  }
  return ctx;
}

interface PaneProviderProps {
  group: Pane;
  taskId: string;
  projectId: string;
  isFocusedPane: boolean;
  children: ReactNode;
}

/**
 * Wraps a single pane with its PaneContext value and a per-pane EditorProvider.
 * Use this in SplitPaneLayout instead of nesting PaneContext.Provider and
 * EditorProvider manually.
 */
export function PaneProvider({
  group,
  taskId,
  projectId,
  isFocusedPane,
  children,
}: PaneProviderProps) {
  return (
    <PaneContext.Provider value={{ paneId: group.paneId, pane: group.pane, isFocusedPane }}>
      <EditorProvider taskId={taskId} projectId={projectId}>
        {children}
      </EditorProvider>
    </PaneContext.Provider>
  );
}
