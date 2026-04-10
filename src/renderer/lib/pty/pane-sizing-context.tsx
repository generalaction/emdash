/**
 * PaneSizingContext — owns PTY resize for every session that belongs to a pane.
 *
 * The active TerminalPane calls reportDimensions(cols, rows) whenever its
 * terminal resizes.  The provider then forwards that resize to ALL registered
 * sessions (active + background), so background agents always have the correct
 * terminal width even when they are off-screen.
 *
 * Each provider renders a wrapper <div> that fills its parent and registers
 * itself in the module-level paneRegistry under its paneId.  This lets any
 * code outside the React tree (e.g. hover pre-warm, cross-pane coordination)
 * call getPaneContainer(paneId) to measure the pane's pixel dimensions without
 * needing a mounted terminal.
 *
 * Usage:
 *   <PaneSizingProvider paneId="conversations" sessionIds={allConversationSessionIds}>
 *     ...
 *     <TerminalPane sessionId={activeSessionId} />
 *   </PaneSizingProvider>
 *
 * For split panes (e.g. conversation pane + right-panel terminal pane), each
 * pane gets its own <PaneSizingProvider> with a distinct paneId.  No other
 * changes required.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { rpc } from '@renderer/lib/ipc';
import { measureDimensions, type TerminalDimensions } from './pty-dimensions';

const PTY_RESIZE_DEBOUNCE_MS = 60;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;

// ── Module-level pane registry ────────────────────────────────────────────────
// Maps paneId → the provider's container HTMLDivElement.  Survives renders and
// is accessible from anywhere in the renderer process (e.g. sidebar hover
// handlers, cross-pane coordinators).
const paneRegistry = new Map<string, HTMLDivElement>();

/**
 * Returns the container element for the given pane, or null if the pane is not
 * currently mounted.  Use this to measure pane pixel dimensions from outside
 * the React tree.
 */
export function getPaneContainer(paneId: string): HTMLDivElement | null {
  return paneRegistry.get(paneId) ?? null;
}

// ── Context interface ─────────────────────────────────────────────────────────

export interface PaneSizingContextValue {
  /**
   * Called by the active terminal after every resize.  Broadcasts the
   * dimensions to all registered sessions (active + background) after a short
   * debounce.
   */
  reportDimensions: (cols: number, rows: number) => void;
  /**
   * Returns the last dimensions reported to this pane, or null if no terminal
   * has reported dimensions yet.  Used as a fallback when cell metrics are
   * unavailable (very first mount).
   */
  getCurrentDimensions: () => { cols: number; rows: number } | null;
  /**
   * Ref to the provider's own wrapper div.  Always reflects the pane's current
   * pixel size; suitable as the container argument to measureDimensions().
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Measures the pane container using the provided cell metrics and returns
   * cols/rows, or null if the container is not yet sized.  More accurate than
   * getCurrentDimensions() when cell metrics are available because it reads the
   * live DOM instead of a cached value.
   */
  measureCurrentDimensions: (cellWidth: number, cellHeight: number) => TerminalDimensions | null;
}

const PaneSizingContext = createContext<PaneSizingContextValue | null>(null);

/**
 * Returns the nearest PaneSizingContext value, or null when the terminal is
 * not inside a PaneSizingProvider (e.g. standalone chat terminals).
 */
export function usePaneSizingContext(): PaneSizingContextValue | null {
  return useContext(PaneSizingContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface PaneSizingProviderProps {
  /** Stable identifier for this pane.  Used to register in the module-level
   *  paneRegistry so code outside the React tree can measure this pane. */
  paneId: string;
  /** All session IDs that belong to this pane (active + background). */
  sessionIds: string[];
  children: ReactNode;
}

export function PaneSizingProvider({ paneId, sessionIds, children }: PaneSizingProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<string[]>([]);
  const lastDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDimsRef = useRef<{ cols: number; rows: number } | null>(null);

  // Register/unregister this pane in the module-level registry.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    paneRegistry.set(paneId, el);
    return () => {
      paneRegistry.delete(paneId);
    };
  }, [paneId]);

  // When sessionIds change, send the current known dimensions to any sessions
  // that are newly added (e.g. a conversation was just created).
  useEffect(() => {
    const prev = sessionsRef.current;
    const added = sessionIds.filter((id) => !prev.includes(id));
    sessionsRef.current = sessionIds;
    const dims = lastDimensionsRef.current;
    if (dims && added.length > 0) {
      for (const id of added) {
        rpc.pty.resize(id, dims.cols, dims.rows);
      }
    }
  }, [sessionIds]);

  // Clear debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
      }
    };
  }, []);

  const flush = useCallback(() => {
    const dims = pendingDimsRef.current;
    pendingDimsRef.current = null;
    if (!dims) return;
    lastDimensionsRef.current = dims;
    for (const id of sessionsRef.current) {
      rpc.pty.resize(id, dims.cols, dims.rows);
    }
  }, []);

  const reportDimensions = useCallback(
    (cols: number, rows: number) => {
      const c = Math.max(MIN_TERMINAL_COLS, cols);
      const r = Math.max(MIN_TERMINAL_ROWS, rows);
      // No dedup here: a newly active session's PTY may not have received the
      // resize yet even if the pane dimensions are unchanged, so we always
      // broadcast.  The debounce timer coalesces rapid calls.
      pendingDimsRef.current = { cols: c, rows: r };
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        flush();
      }, PTY_RESIZE_DEBOUNCE_MS);
    },
    [flush]
  );

  const getCurrentDimensions = useCallback(
    (): { cols: number; rows: number } | null => lastDimensionsRef.current,
    []
  );

  const measureCurrentDimensions = useCallback(
    (cellWidth: number, cellHeight: number): TerminalDimensions | null => {
      const el = containerRef.current;
      if (!el) return null;
      return measureDimensions(el, cellWidth, cellHeight);
    },
    []
  );

  const value = useMemo(
    () => ({ reportDimensions, getCurrentDimensions, containerRef, measureCurrentDimensions }),
    [reportDimensions, getCurrentDimensions, measureCurrentDimensions]
  );

  return (
    <PaneSizingContext.Provider value={value}>
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col p-2">
        {children}
      </div>
    </PaneSizingContext.Provider>
  );
}
