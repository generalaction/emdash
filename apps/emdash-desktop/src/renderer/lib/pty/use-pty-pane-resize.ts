/**
 * usePtyPaneResize — per-pane PTY resize controller.
 *
 * Owns the single source of truth for cols/rows within a pane:
 *   1. Reacts to the pane's observable pixel dimensions (PaneDimensionSink) via MobX.
 *   2. Converts px → cols/rows using a cached cell size derived from standalone
 *      canvas measurement (so PTYs resize even when no terminal is mounted).
 *   3. Accepts calibration from a live terminal for maximum accuracy once one mounts.
 *   4. Broadcasts rpc.pty.resize to ALL session IDs in the pane (active + background).
 *   5. Exposes an observable `controllerDims` box so mounted terminals can call
 *      term.resize() reactively without re-measuring.
 *   6. Suppresses resize events during panel drags; triggers a final recompute on release.
 *   7. Listens to terminal-font-changed events and recomputes when font settings change.
 *
 * Must be called inside a PaneDimensionProvider so the sink is available.
 */

import type { IObservableValue } from 'mobx';
import { observable, reaction, runInAction } from 'mobx';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { PaneDimensionSink } from '@renderer/features/tabs/pane-dimension-provider';
import { rpc } from '@renderer/lib/ipc';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { TERMINAL_FONT_SIZE_DEFAULT } from '@shared/core/terminals/terminal-settings';
import { invalidateCellMetricsCache, measureTerminalCell } from './pty-dimensions';
import { createResizeScheduler, type ResizeScheduler } from './resize-scheduler';
import { buildTerminalFontFamily } from './terminal-font';

const PTY_RESIZE_DEBOUNCE_MS = 60;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;

export interface PtyPaneResizeControls {
  /**
   * Observable box tracking the current cols/rows computed by the controller.
   * Mounted terminals subscribe to this to keep their xterm grid in sync without
   * re-measuring themselves.
   */
  controllerDims: IObservableValue<{ cols: number; rows: number } | null>;
  /**
   * Called by a mounted terminal with its exact CSS cell dimensions.
   * Updates the controller's cell size and triggers an immediate recompute
   * so the grid and backend stay in lockstep with the correct measurements.
   */
  calibrateCell(width: number, height: number): void;
  /**
   * Returns the latest known cols/rows synchronously, for pre-mount sizing.
   * Returns null if neither standalone measurement nor calibration has produced
   * a result yet.
   */
  getCurrentDimensions(): { cols: number; rows: number } | null;
}

export function usePtyPaneResize(
  sessionIds: string[],
  sink: PaneDimensionSink | null
): PtyPaneResizeControls {
  const sessionsRef = useRef<string[]>([]);

  // ── Observable controller dims box (stable across renders) ──────────────────
  const controllerDimsBoxRef =
    useRef<IObservableValue<{ cols: number; rows: number } | null>>(null);
  if (controllerDimsBoxRef.current === null) {
    controllerDimsBoxRef.current = observable.box<{ cols: number; rows: number } | null>(null);
  }
  const controllerDims = controllerDimsBoxRef.current;

  // ── Cell size: seeded from standalone measurement, refined by calibration ───
  const cellSizeRef = useRef<{ width: number; height: number } | null>(null);
  if (cellSizeRef.current === null) {
    // Prime with the default font so the controller can broadcast before any
    // terminal has mounted in the pane.
    cellSizeRef.current = measureTerminalCell(
      buildTerminalFontFamily(),
      TERMINAL_FONT_SIZE_DEFAULT
    );
  }

  // ── Broadcast scheduler ─────────────────────────────────────────────────────
  const schedulerRef = useRef<ResizeScheduler<{ cols: number; rows: number }> | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createResizeScheduler((dims) => {
      for (const id of sessionsRef.current) {
        void rpc.pty.resize(id, dims.cols, dims.rows);
      }
    }, PTY_RESIZE_DEBOUNCE_MS);
  }

  // ── Drag state (suppress resize during panel drags) ─────────────────────────
  const isPanelDragging = useSyncExternalStore(
    panelDragStore.subscribe,
    panelDragStore.getSnapshot
  );
  const isPanelDraggingRef = useRef(isPanelDragging);
  isPanelDraggingRef.current = isPanelDragging;

  // ── Core recompute ──────────────────────────────────────────────────────────
  // Converts the pane's pixel dimensions + current cell size → cols/rows,
  // updates the observable box, and schedules a backend broadcast.
  const sinkRef = useRef<PaneDimensionSink | null>(sink);
  sinkRef.current = sink;

  const recompute = useCallback(() => {
    const currentSink = sinkRef.current;
    const cell = cellSizeRef.current;
    const pixelDims = currentSink?.dimensions;
    if (!cell || !pixelDims) return;

    const cols = Math.max(MIN_TERMINAL_COLS, Math.floor(pixelDims.width / cell.width));
    const rows = Math.max(MIN_TERMINAL_ROWS, Math.floor(pixelDims.height / cell.height));

    runInAction(() => {
      controllerDimsBoxRef.current!.set({ cols, rows });
    });
    schedulerRef.current?.schedule({ cols, rows });
  }, []);

  const recomputeRef = useRef(recompute);
  recomputeRef.current = recompute;

  // ── MobX reaction: recompute when pane pixel dimensions change ───────────────
  // Runs synchronously within the ResizeObserver callback (MobX action → reaction),
  // preserving the "resize before next paint" guarantee (ENG-1577).
  useEffect(() => {
    if (!sink) return;
    const dispose = reaction(
      () => sink.dimensions,
      () => {
        if (isPanelDraggingRef.current) return;
        recomputeRef.current();
      }
    );
    // Fire immediately if we already have dimensions.
    if (sink.dimensions) recomputeRef.current();
    return dispose;
    // `sink` identity only changes when PaneSizingContextProvider re-mounts.
    // eslint-disable-next-line react/exhaustive-deps
  }, [sink]);

  // ── Recompute on drag end ───────────────────────────────────────────────────
  const prevIsDraggingRef = useRef(isPanelDragging);
  useEffect(() => {
    const wasDragging = prevIsDraggingRef.current;
    prevIsDraggingRef.current = isPanelDragging;
    if (wasDragging && !isPanelDragging) {
      recomputeRef.current();
    }
  }, [isPanelDragging]);

  // ── Font-change event: invalidate standalone cache and recompute ─────────────
  useEffect(() => {
    const handleFontChange = (e: Event) => {
      const detail = (e as CustomEvent<{ fontFamily?: string; fontSize?: number }>).detail;
      const fontFamily = buildTerminalFontFamily(detail?.fontFamily ?? '');
      const fontSize = detail?.fontSize ?? TERMINAL_FONT_SIZE_DEFAULT;
      invalidateCellMetricsCache();
      const newCell = measureTerminalCell(fontFamily, fontSize);
      if (newCell) {
        cellSizeRef.current = newCell;
        recomputeRef.current();
      }
    };
    window.addEventListener('terminal-font-changed', handleFontChange);
    return () => window.removeEventListener('terminal-font-changed', handleFontChange);
  }, []);

  // ── Session IDs: send current dims to newly added sessions ──────────────────
  useEffect(() => {
    const prev = sessionsRef.current;
    const added = sessionIds.filter((id) => !prev.includes(id));
    sessionsRef.current = sessionIds;
    const dims = controllerDimsBoxRef.current!.get();
    if (dims && added.length > 0) {
      for (const id of added) {
        void rpc.pty.resize(id, dims.cols, dims.rows);
      }
    }
  }, [sessionIds]);

  // ── Cancel pending flush on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => schedulerRef.current?.cancel();
  }, []);

  // ── Public API ──────────────────────────────────────────────────────────────
  const calibrateCell = useCallback((width: number, height: number) => {
    if (cellSizeRef.current?.width === width && cellSizeRef.current?.height === height) {
      return;
    }
    cellSizeRef.current = { width, height };
    recomputeRef.current();
  }, []);

  const getCurrentDimensions = useCallback(
    (): { cols: number; rows: number } | null => controllerDimsBoxRef.current!.get(),
    []
  );

  return useMemo(
    () => ({ controllerDims, calibrateCell, getCurrentDimensions }),
    [controllerDims, calibrateCell, getCurrentDimensions]
  );
}
