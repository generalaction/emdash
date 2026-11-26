import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Display, Rectangle } from 'electron';
import { z } from 'zod';

const rectangle = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const placement = z.object({
  bounds: rectangle,
  displayId: z.number().int(),
  workArea: rectangle,
  maximized: z.boolean(),
  fullscreen: z.boolean(),
});

type Placement = z.infer<typeof placement>;
type WindowDisplay = Pick<Display, 'id' | 'workArea'>;

export function readWindowPlacement(path: string): Placement | undefined {
  try {
    return placement.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export function saveWindowPlacement(path: string, state: Placement): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, path);
}

export function restoreWindowBounds(
  saved: Placement,
  displays: readonly WindowDisplay[],
  primary: WindowDisplay
): Rectangle {
  const original = saved.workArea;
  const sameArea = (area: Rectangle) =>
    area.x === original.x &&
    area.y === original.y &&
    area.width === original.width &&
    area.height === original.height;
  const display =
    displays.find(({ id }) => id === saved.displayId) ??
    displays.find(({ workArea }) => sameArea(workArea));
  const area = display?.workArea ?? primary.workArea;
  const { bounds } = saved;
  // Preserve deliberate tiling and windows spanning adjacent displays.
  if (
    display &&
    sameArea(area) &&
    displays.some(
      ({ workArea: w }) =>
        bounds.y >= w.y &&
        bounds.y + 24 <= w.y + w.height &&
        Math.min(bounds.x + bounds.width, w.x + w.width) - Math.max(bounds.x, w.x) >= 64
    )
  ) {
    return bounds;
  }

  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const offsetX = display ? bounds.x - original.x : Math.floor((area.width - width) / 2);
  const offsetY = display ? bounds.y - original.y : Math.floor((area.height - height) / 2);
  return {
    x: area.x + Math.max(0, Math.min(offsetX, area.width - width)),
    y: area.y + Math.max(0, Math.min(offsetY, area.height - height)),
    width,
    height,
  };
}
