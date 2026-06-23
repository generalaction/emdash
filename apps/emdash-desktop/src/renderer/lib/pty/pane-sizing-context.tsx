/**
 * PaneSizingContext — backwards-compatibility wrapper.
 *
 * Composes PaneDimensionProvider (generic container + ResizeObserver sink) with
 * usePtyPaneResize (PTY broadcast) and exposes the unified value via
 * PaneSizingContext so that use-pty.ts continues to work without changes.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PaneDimensionSink } from '@renderer/features/tabs/pane-dimension-provider';
import {
  PaneDimensionProvider,
  usePaneDimensions,
} from '@renderer/features/tabs/pane-dimension-provider';
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

interface PaneSizingProviderProps {
  sink: PaneDimensionSink;
  sessionIds: string[];
  children: ReactNode;
}

export function PaneSizingProvider({ sink, sessionIds, children }: PaneSizingProviderProps) {
  return (
    <PaneDimensionProvider sink={sink}>
      <PaneSizingInner sessionIds={sessionIds}>{children}</PaneSizingInner>
    </PaneDimensionProvider>
  );
}

/**
 * Provides PaneSizingContext by reading the nearest PaneDimensionProvider and
 * calling usePtyPaneResize.
 *
 * Use this when a PaneDimensionProvider is already mounted by an ancestor (e.g.
 * by SplitPane), so you only need to add the PTY broadcast layer without
 * creating a second container div.
 */
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

function PaneSizingInner({ sessionIds, children }: { sessionIds: string[]; children: ReactNode }) {
  return <PaneSizingContextProvider sessionIds={sessionIds}>{children}</PaneSizingContextProvider>;
}
