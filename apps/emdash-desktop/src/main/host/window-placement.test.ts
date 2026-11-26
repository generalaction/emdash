import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWindowPlacement, restoreWindowBounds, saveWindowPlacement } from './window-placement';

const primary = { id: 1, workArea: { x: 0, y: 24, width: 1280, height: 776 } };
const left = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } };
const saved = {
  bounds: { x: -1600, y: 80, width: 1300, height: 850 },
  displayId: left.id,
  workArea: left.workArea,
  maximized: false,
  fullscreen: false,
};

describe('main window placement', () => {
  it('keeps exact coordinates and size on an attached external display', () => {
    expect(restoreWindowBounds(saved, [primary, left], primary)).toEqual(saved.bounds);
  });

  it('recognizes the same layout after a display identifier changes', () => {
    expect(restoreWindowBounds(saved, [primary, { ...left, id: 3 }], primary)).toEqual(
      saved.bounds
    );
  });

  it('fits the window to the primary work area after unplugging the external display', () => {
    expect(restoreWindowBounds(saved, [primary], primary)).toEqual(primary.workArea);
  });

  it('preserves the relative offset when a display moves', () => {
    const moved = { ...left, workArea: { ...left.workArea, x: 1280 } };
    expect(restoreWindowBounds(saved, [primary, moved], primary)).toEqual({
      ...saved.bounds,
      x: 1600,
    });
  });

  it('recovers a window whose title bar is offscreen', () => {
    const bounds = restoreWindowBounds(
      { ...saved, bounds: { ...saved.bounds, y: -500 } },
      [left],
      left
    );
    expect(bounds.y).toBe(0);
  });

  it('round-trips the normal bounds and window mode and tolerates absent or invalid files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emdash-placement-'));
    const path = join(dir, 'placement.json');
    try {
      expect(readWindowPlacement(path)).toBeUndefined();
      for (const invalid of [
        '{',
        JSON.stringify({ ...saved, bounds: { ...saved.bounds, width: -1 } }),
      ]) {
        writeFileSync(path, invalid);
        expect(readWindowPlacement(path)).toBeUndefined();
      }
      saveWindowPlacement(path, saved);
      const maximized = { ...saved, maximized: true };
      saveWindowPlacement(path, maximized);
      expect(readWindowPlacement(path)).toEqual(maximized);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
