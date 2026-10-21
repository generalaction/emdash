export type SplitSide = 'left' | 'right';

export type PaneDropTarget =
  | { kind: 'tab-strip'; paneId: string }
  | { kind: 'content'; paneId: string }
  | { kind: 'split'; paneId: string; side: SplitSide };

const PREFIXES = {
  'tab-strip': 'pane-drop-',
  content: 'pane-content-',
  'split-left': 'pane-split-left-',
  'split-right': 'pane-split-right-',
} as const;

/** Encodes every pane-owned droppable using one workbench vocabulary. */
export function paneDropTargetId(target: PaneDropTarget): string {
  if (target.kind === 'split') return `${PREFIXES[`split-${target.side}`]}${target.paneId}`;
  return `${PREFIXES[target.kind]}${target.paneId}`;
}

/** Pane ids may contain hyphens, so decoding always slices a known prefix. */
export function parsePaneDropTargetId(id: string): PaneDropTarget | null {
  if (id.startsWith(PREFIXES['tab-strip'])) {
    return { kind: 'tab-strip', paneId: id.slice(PREFIXES['tab-strip'].length) };
  }
  if (id.startsWith(PREFIXES.content)) {
    return { kind: 'content', paneId: id.slice(PREFIXES.content.length) };
  }
  for (const side of ['left', 'right'] as const) {
    const prefix = PREFIXES[`split-${side}`];
    if (id.startsWith(prefix)) return { kind: 'split', paneId: id.slice(prefix.length), side };
  }
  return null;
}

export function isPaneSplitDropTargetId(id: string): boolean {
  return parsePaneDropTargetId(id)?.kind === 'split';
}
