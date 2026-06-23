/**
 * PaneSizingContext — PTY sizing bridge for a pane.
 *
 * Reads the nearest PaneDimensionProvider (mounted by SplitPane) and adds a
 * single usePtyPaneResize broadcaster shared across all terminals in the pane.
 * Consumed by use-pty.ts via usePaneSizingContext().
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PaneDimensionSink } from '@renderer/features/tabs/pane-dimension-provider';
import { usePaneDimensions } from '@renderer/features/tabs/pane-dimension-provider';
import { usePtyPaneResize } from './use-pty-pane-resize';

// ── Context interface ─────────────────────────────────────────────────────────

export interface PaneSizingContextValue {
  reportDimensions: (cols: number, rows: number) => void;
  getCurrentDimensions: () => { cols: number; rows: number } | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  sink: PaneDimensionSink;
}

const PaneSizingContext = createContext<PaneSizingContextValue | null>(null);

export function usePaneSizingContext(): PaneSizingContextValue | null {
  return useContext(PaneSizingContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function PaneSizingContextProvider({
  sessionIds,
  children,
}: {
  sessionIds: string[];
  children: ReactNode;
}) {
  const dims = usePaneDimensions();
  const { reportDimensions, getCurrentDimensions } = usePtyPaneResize(sessionIds);

  const value = useMemo<PaneSizingContextValue | null>(() => {
    if (!dims) return null;
    return {
      reportDimensions,
      getCurrentDimensions,
      containerRef: dims.containerRef,
      sink: dims.sink,
    };
  }, [dims, reportDimensions, getCurrentDimensions]);

  return <PaneSizingContext.Provider value={value}>{children}</PaneSizingContext.Provider>;
}
