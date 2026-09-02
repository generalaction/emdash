export type SplitSide = 'left' | 'right';

const PREFIXES: Record<SplitSide, string> = {
  left: 'pane-split-left-',
  right: 'pane-split-right-',
};

/**
 * Droppable ids for the edge drop zones that create a new split pane, in the
 * same id-prefix convention as `pane-drop-` and `pane-content-`. Pane ids are
 * UUIDs (they contain hyphens), so parsing is prefix slicing, never splitting.
 */
export function splitDropId(paneId: string, side: SplitSide): string {
  return `${PREFIXES[side]}${paneId}`;
}

export function parseSplitDropId(id: string): { paneId: string; side: SplitSide } | null {
  for (const side of ['left', 'right'] as const) {
    const prefix = PREFIXES[side];
    if (id.startsWith(prefix)) return { paneId: id.slice(prefix.length), side };
  }
  return null;
}

export function isSplitDropId(id: string): boolean {
  return parseSplitDropId(id) !== null;
}
