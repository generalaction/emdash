import { observer } from 'mobx-react-lite';
import { createContext, useContext, type ReactNode } from 'react';
import type { ViewScopeInstance } from '@core/primitives/view-scopes/browser';
import { ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import type { Pane } from './pane-layout-store';
import type { PaneStore } from './pane-store';
import { usePaneScope } from './use-pane-scope';

export interface PaneContextValue {
  paneId: string;
  pane: PaneStore;
  scopeInstance: ViewScopeInstance | undefined;
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
  canSplit: boolean;
  splitPane: () => void;
  children: ReactNode;
}

/**
 * Wraps a single pane with its PaneContext value.
 * Callers (e.g. SplitPaneLayout) are responsible for composing EditorProvider
 * around the pane content outside this component.
 */
export const PaneProvider = observer(function PaneProvider({
  group,
  canSplit,
  splitPane,
  children,
}: PaneProviderProps) {
  const { attachRef, instance, isFocused } = usePaneScope(group.paneId, group.pane, {
    canSplit,
    splitPane,
  });

  return (
    <PaneContext.Provider
      value={{
        paneId: group.paneId,
        pane: group.pane,
        scopeInstance: instance,
        isFocusedPane: isFocused,
      }}
    >
      <ViewScopeInstanceProvider instance={instance}>
        <div
          ref={attachRef}
          tabIndex={-1}
          className="h-full min-w-0 outline-none"
          onPointerDownCapture={(event) => event.currentTarget.focus({ preventScroll: true })}
        >
          {children}
        </div>
      </ViewScopeInstanceProvider>
    </PaneContext.Provider>
  );
});
