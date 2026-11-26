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

// Within each vertical strip between display edges, the available y intervals
// are constant. Check their union so mirrored displays cannot hide a gap.
function fullyVisible(bounds: Rectangle, displays: readonly WindowDisplay[]): boolean {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const areas = displays.map(({ workArea }) => workArea).sort((a, b) => a.y - b.y);
  const edges = areas
    .flatMap((area) => [area.x, area.x + area.width])
    .filter((x) => x > bounds.x && x < right);
  const cuts = [...new Set([bounds.x, ...edges, right])].sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    let coveredY = bounds.y;
    for (const area of areas) {
      if (area.x <= cuts[i - 1] && area.x + area.width >= cuts[i] && area.y <= coveredY) {
        coveredY = Math.max(coveredY, area.y + area.height);
      }
    }
    if (coveredY < bottom) return false;
  }
  return true;
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
  if (display && sameArea(area) && fullyVisible(bounds, displays)) {
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
