import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDebouncedSaver,
  fitsOnDisplay,
  parseWindowState,
  readWindowStateFile,
  resolveWindowState,
  writeWindowStateFile,
  type Rect,
  type WindowState,
} from './window-state';

const DEFAULT_SIZE = { width: 1400, height: 900 };
const MIN_SIZE = { width: 700, height: 500 };
const PRIMARY: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

const SAVED: WindowState = {
  x: 100,
  y: 80,
  width: 1200,
  height: 800,
  maximized: false,
  fullScreen: false,
};

function resolve(raw: string | null, workAreas: Rect[] = [PRIMARY]) {
  return resolveWindowState({ raw, workAreas, defaultSize: DEFAULT_SIZE, minSize: MIN_SIZE });
}

describe('parseWindowState', () => {
  it('reads bounds and both mode flags', () => {
    expect(parseWindowState(JSON.stringify({ ...SAVED, maximized: true }))).toEqual({
      ...SAVED,
      maximized: true,
    });
  });

  it('defaults absent mode flags to windowed', () => {
    expect(parseWindowState(JSON.stringify({ x: 1, y: 2, width: 3, height: 4 }))).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      maximized: false,
      fullScreen: false,
    });
  });

  it('rejects a truncated write', () => {
    expect(parseWindowState('{"x":100,"y":80,"wid')).toBeNull();
  });

  it('rejects a missing coordinate', () => {
    expect(parseWindowState(JSON.stringify({ x: 1, y: 2, width: 3 }))).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    expect(parseWindowState('{"x":0,"y":0,"width":null,"height":800}')).toBeNull();
    expect(parseWindowState(JSON.stringify({ ...SAVED, width: '1200' }))).toBeNull();
  });

  it('rejects a payload that is not an object', () => {
    expect(parseWindowState('42')).toBeNull();
    expect(parseWindowState('null')).toBeNull();
  });
});

describe('fitsOnDisplay', () => {
  it('accepts bounds inside a work area', () => {
    expect(fitsOnDisplay({ x: 10, y: 10, width: 800, height: 600 }, [PRIMARY])).toBe(true);
  });

  it('rejects bounds that overhang the right edge', () => {
    expect(fitsOnDisplay({ x: 1800, y: 10, width: 800, height: 600 }, [PRIMARY])).toBe(false);
  });

  it('rejects bounds above the work area, where a menu bar would hide the title bar', () => {
    expect(fitsOnDisplay({ x: 10, y: -40, width: 800, height: 600 }, [PRIMARY])).toBe(false);
  });

  it('accepts bounds on a secondary display', () => {
    const secondary: Rect = { x: 1920, y: 0, width: 1280, height: 800 };
    const bounds: Rect = { x: 2000, y: 40, width: 900, height: 600 };
    expect(fitsOnDisplay(bounds, [PRIMARY, secondary])).toBe(true);
    expect(fitsOnDisplay(bounds, [PRIMARY])).toBe(false);
  });
});

describe('resolveWindowState', () => {
  it('centers a default-sized window on first launch', () => {
    expect(resolve(null)).toEqual({
      creationBounds: DEFAULT_SIZE,
      maximized: false,
      fullScreen: false,
    });
  });

  it('restores a saved rectangle that still fits', () => {
    expect(resolve(JSON.stringify(SAVED)).creationBounds).toEqual({
      x: 100,
      y: 80,
      width: 1200,
      height: 800,
    });
  });

  it('falls back to the default size when the file is corrupt', () => {
    expect(resolve('not json').creationBounds).toEqual(DEFAULT_SIZE);
  });

  it('keeps the mode when the display the window was on is gone', () => {
    const raw = JSON.stringify({ ...SAVED, x: 2400, maximized: true });
    expect(resolve(raw)).toEqual({
      creationBounds: DEFAULT_SIZE,
      maximized: true,
      fullScreen: false,
    });
  });

  it('keeps the mode when the saved rectangle is below the minimum size', () => {
    const raw = JSON.stringify({ ...SAVED, width: 320, height: 240, fullScreen: true });
    expect(resolve(raw)).toEqual({
      creationBounds: DEFAULT_SIZE,
      maximized: false,
      fullScreen: true,
    });
  });

  it('restores maximized alongside the rectangle it returns to', () => {
    const raw = JSON.stringify({ ...SAVED, maximized: true });
    expect(resolve(raw)).toEqual({
      creationBounds: { x: 100, y: 80, width: 1200, height: 800 },
      maximized: true,
      fullScreen: false,
    });
  });
});

describe('window state file', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function scratchDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'emdash-window-state-'));
    dirs.push(dir);
    return dir;
  }

  it('round-trips through the file', () => {
    const path = join(scratchDir(), 'window-state.json');
    writeWindowStateFile(path, { ...SAVED, fullScreen: true });
    expect(parseWindowState(readWindowStateFile(path)!)).toEqual({ ...SAVED, fullScreen: true });
  });

  it('reads a missing file as no saved state', () => {
    expect(readWindowStateFile(join(scratchDir(), 'window-state.json'))).toBeNull();
  });

  it('survives a write to an unwritable path', () => {
    const path = join(scratchDir(), 'no-such-dir', 'window-state.json');
    expect(() => writeWindowStateFile(path, SAVED)).not.toThrow();
  });

  it('overwrites a stale file rather than appending to it', () => {
    const path = join(scratchDir(), 'window-state.json');
    writeFileSync(path, JSON.stringify({ ...SAVED, width: 1900, height: 1000 }));
    writeWindowStateFile(path, SAVED);
    expect(parseWindowState(readWindowStateFile(path)!)).toEqual(SAVED);
  });
});

describe('createDebouncedSaver', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a resize storm into one write of the final value', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const saver = createDebouncedSaver(write, 500);

    for (const width of [800, 900, 1000]) saver.update(width);
    vi.advanceTimersByTime(499);
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledExactlyOnceWith(1000);
  });

  it('writes pending state immediately on flush', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const saver = createDebouncedSaver(write, 500);

    saver.update(1000);
    saver.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith(1000);

    // The timer the update armed must not fire a second write after the flush.
    vi.advanceTimersByTime(500);
    expect(write).toHaveBeenCalledOnce();
  });

  it('does nothing when flushed with nothing pending', () => {
    const write = vi.fn();
    createDebouncedSaver(write, 500).flush();
    expect(write).not.toHaveBeenCalled();
  });
});
