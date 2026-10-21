import { describe, expect, it } from 'vitest';
import {
  isPaneSplitDropTargetId,
  paneDropTargetId,
  parsePaneDropTargetId,
  type PaneDropTarget,
} from './pane-drop-target';

describe('pane-drop-target', () => {
  it.each<PaneDropTarget>([
    { kind: 'tab-strip', paneId: 'pane-with-hyphens' },
    { kind: 'content', paneId: 'pane-with-hyphens' },
    { kind: 'split', paneId: 'pane-with-hyphens', side: 'left' },
    { kind: 'split', paneId: 'pane-with-hyphens', side: 'right' },
  ])('round-trips $kind targets', (target) => {
    expect(parsePaneDropTargetId(paneDropTargetId(target))).toEqual(target);
  });

  it('returns null for tab ids and malformed targets', () => {
    expect(parsePaneDropTargetId('some-tab-id')).toBeNull();
    expect(parsePaneDropTargetId('pane-split-middle-abc')).toBeNull();
  });

  it('identifies only split targets', () => {
    expect(
      isPaneSplitDropTargetId(paneDropTargetId({ kind: 'split', paneId: 'abc', side: 'left' }))
    ).toBe(true);
    expect(isPaneSplitDropTargetId(paneDropTargetId({ kind: 'content', paneId: 'abc' }))).toBe(
      false
    );
  });
});
