/**
 * usePtyPaneResize — PTY-specific resize broadcast for a pane.
 *
 * Reads the nearest PaneDimensionProvider's container ref and exposes a
 * `reportDimensions` callback that debounces and broadcasts a resize to every
 * session in `sessionIds` (active + background).  When sessionIds changes,
 * newly added sessions receive the last known dimensions immediately.
 *
 * Must be called inside a PaneDimensionProvider so usePaneDimensions() resolves.
 * Returns `{ reportDimensions, getCurrentDimensions }` for use as a
 * PaneSizingContext value (or to be provided via any context the caller chooses).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { rpc } from '@renderer/lib/ipc';

const PTY_RESIZE_DEBOUNCE_MS = 60;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;

export interface PtyPaneResizeControls {
  /**
   * Called by the active terminal after every resize.  Broadcasts the
   * dimensions to all registered sessions (active + background) after a short
   * debounce.
   */
  reportDimensions: (cols: number, rows: number) => void;
  /**
   * Returns the last dimensions reported to this pane, or null if no terminal
   * has reported dimensions yet.
   */
  getCurrentDimensions: () => { cols: number; rows: number } | null;
}

export function usePtyPaneResize(sessionIds: string[]): PtyPaneResizeControls {
  const sessionsRef = useRef<string[]>([]);
  const lastDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDimsRef = useRef<{ cols: number; rows: number } | null>(null);

  // When sessionIds change, send the current known dimensions to any sessions
  // that are newly added (e.g. a conversation was just created).
  useEffect(() => {
    const prev = sessionsRef.current;
    const added = sessionIds.filter((id) => !prev.includes(id));
    sessionsRef.current = sessionIds;
    const dims = lastDimensionsRef.current;
    if (dims && added.length > 0) {
      for (const id of added) {
        void rpc.pty.resize(id, dims.cols, dims.rows);
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
      void rpc.pty.resize(id, dims.cols, dims.rows);
    }
  }, []);

  const reportDimensions = useCallback(
    (cols: number, rows: number) => {
      const c = Math.max(MIN_TERMINAL_COLS, cols);
      const r = Math.max(MIN_TERMINAL_ROWS, rows);
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

  return useMemo(
    () => ({ reportDimensions, getCurrentDimensions }),
    [reportDimensions, getCurrentDimensions]
  );
}
