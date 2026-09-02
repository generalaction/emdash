import { describe, expect, it } from 'vitest';
import { isSplitDropId, parseSplitDropId, splitDropId } from './split-drop-id';

describe('split-drop-id', () => {
  it('round-trips pane ids containing hyphens (UUIDs)', () => {
    const paneId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(parseSplitDropId(splitDropId(paneId, 'left'))).toEqual({ paneId, side: 'left' });
    expect(parseSplitDropId(splitDropId(paneId, 'right'))).toEqual({ paneId, side: 'right' });
  });

  it('returns null for non-split droppable ids', () => {
    expect(parseSplitDropId('pane-drop-abc')).toBeNull();
    expect(parseSplitDropId('pane-content-abc')).toBeNull();
    expect(parseSplitDropId('some-tab-id')).toBeNull();
  });

  it('isSplitDropId matches only split ids', () => {
    expect(isSplitDropId(splitDropId('abc', 'left'))).toBe(true);
    expect(isSplitDropId('pane-content-abc')).toBe(false);
  });
});
