import { readFileSync, writeFileSync } from 'node:fs';
import { log } from '@main/lib/logger';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The persisted geometry: the unmaximized rectangle plus the display modes
 * layered on top of it.
 *
 * The modes have to be stored explicitly. macOS reports a zoomed or fullscreen
 * window's normal bounds as the rectangle it returns to — for a window zoomed
 * right after first launch that is the centered default forever — so bounds
 * alone would restore a maximized session as a plain default-sized window.
 */
export interface WindowState extends Rect {
  maximized: boolean;
  fullScreen: boolean;
}

export const WINDOW_STATE_FILE_NAME = 'window-state.json';

/** Interactive resizes emit dozens of events a second; one write per settle is enough. */
export const SAVE_DEBOUNCE_MS = 500;

/**
 * Parse persisted state, requiring four finite numbers. Anything else — a
 * partial write, a hand-edited file — reads as no saved state rather than an
 * error. The mode flags are optional so a bounds-only file restores windowed.
 */
export function parseWindowState(raw: string): WindowState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { x, y, width, height, maximized, fullScreen } = parsed as Record<string, unknown>;
  if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return null;
  }
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    maximized: maximized === true,
    fullScreen: fullScreen === true,
  };
}

/**
 * A saved rectangle is restorable only when it sits fully inside one current
 * display's work area. Bounds saved on a display that has since been unplugged
 * or rearranged would come back partly off-screen, potentially with the title
 * bar out of reach.
 */
export function fitsOnDisplay(bounds: Rect, workAreas: readonly Rect[]): boolean {
  return workAreas.some(
    (area) =>
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height
  );
}

export interface ResolveWindowStateOptions {
  /** Contents of the window-state file, or null when it does not exist. */
  raw: string | null;
  /** Work areas of the displays currently attached. */
  workAreas: readonly Rect[];
  defaultSize: Size;
  minSize: Size;
}

/** A positionless rectangle lets the OS center the window. */
export interface WindowCreationBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface ResolvedWindowState {
  creationBounds: WindowCreationBounds;
  maximized: boolean;
  fullScreen: boolean;
}

/**
 * What a new window should be created as. The saved rectangle is used when it
 * is intact, at least the window's minimum size, and safe to restore on the
 * current displays — the default size otherwise.
 *
 * The mode flags survive a rectangle fallback independently: maximize and
 * fullscreen re-derive their geometry from whatever display the window lands
 * on, so a stale rectangle is no reason to drop the mode the user was in.
 */
export function resolveWindowState(options: ResolveWindowStateOptions): ResolvedWindowState {
  const { raw, workAreas, defaultSize, minSize } = options;
  const fallback: WindowCreationBounds = { width: defaultSize.width, height: defaultSize.height };
  const saved = raw === null ? null : parseWindowState(raw);
  if (!saved) return { creationBounds: fallback, maximized: false, fullScreen: false };

  const { maximized, fullScreen } = saved;
  const bounds: Rect = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  if (bounds.width < minSize.width || bounds.height < minSize.height) {
    return { creationBounds: fallback, maximized, fullScreen };
  }
  if (!fitsOnDisplay(bounds, workAreas)) {
    return { creationBounds: fallback, maximized, fullScreen };
  }
  return { creationBounds: bounds, maximized, fullScreen };
}

/** Missing or unreadable both mean "no saved state" — the first launch case. */
export function readWindowStateFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Losing a write costs the next launch its geometry, so failure is logged, not thrown. */
export function writeWindowStateFile(filePath: string, state: WindowState): void {
  try {
    writeFileSync(filePath, JSON.stringify(state));
  } catch (error) {
    log.warn('Failed to persist window state', { error });
  }
}

export interface DebouncedSaver<T> {
  update(value: T): void;
  flush(): void;
}

/**
 * Coalesces updates into one write per settle: each update re-arms the timer
 * and only the latest value survives. `flush` writes what is pending
 * immediately — the window-close path, where waiting out the timer would lose
 * the final state.
 */
export function createDebouncedSaver<T>(
  write: (value: T) => void,
  delayMs: number = SAVE_DEBOUNCE_MS
): DebouncedSaver<T> {
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    timer = null;
    if (pending === null) return;
    const value = pending;
    pending = null;
    write(value);
  };

  return {
    update(value: T): void {
      pending = value;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    },
    flush(): void {
      if (timer !== null) clearTimeout(timer);
      fire();
    },
  };
}
