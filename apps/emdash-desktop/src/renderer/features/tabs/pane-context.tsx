import { createContext, useContext, type ReactNode } from 'react';
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
  isFocusedPane: boolean;
  children: ReactNode;
}

/**
 * Wraps a single pane with its PaneContext value.
 * Callers (e.g. SplitPaneLayout) are responsible for composing EditorProvider
 * around the pane content outside this component.
 */
export function PaneProvider({
  group,
  isFocusedPane,
  children,
}: Omit<PaneProviderProps, 'taskId' | 'projectId'>) {
  return (
    <PaneContext.Provider value={{ paneId: group.paneId, pane: group.pane, isFocusedPane }}>
      {children}
    </PaneContext.Provider>
  );
}
