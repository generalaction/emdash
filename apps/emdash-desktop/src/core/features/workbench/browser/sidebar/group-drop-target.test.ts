import { describe, expect, it } from 'vitest';
import { groupDropTarget } from './group-drop-target';
import type { SidebarRow } from './sidebar-store';

// 0 p-ungrouped | 1 [A] | 2 p-a | 3 t-a | 4 [B] | 5 p-b | 6 [C] (collapsed)
const rows: SidebarRow[] = [
  { kind: 'project', projectId: 'p-ungrouped' },
  { kind: 'group', groupId: 'A' },
  { kind: 'project', projectId: 'p-a' },
  { kind: 'task', projectId: 'p-a', taskId: 't-a' },
  { kind: 'group', groupId: 'B' },
  { kind: 'project', projectId: 'p-b' },
  { kind: 'group', groupId: 'C' },
];

describe('groupDropTarget', () => {
  it('returns null when there are no groups', () => {
    expect(groupDropTarget([{ kind: 'project', projectId: 'p' }], 0, true)).toBeNull();
  });

  it('treats the ungrouped section as "before the first group"', () => {
    expect(groupDropTarget(rows, 0, false)).toEqual({
      index: 0,
      indicatorRowIndex: 1,
      edge: 'top',
    });
  });

  it('inserts before a group when over the upper half of its header', () => {
    expect(groupDropTarget(rows, 4, true)).toEqual({ index: 1, indicatorRowIndex: 4, edge: 'top' });
  });

  it('inserts after the whole section when below the header', () => {
    expect(groupDropTarget(rows, 1, false)).toEqual({
      index: 1,
      indicatorRowIndex: 3,
      edge: 'bottom',
    });
  });

  it('inserts after the section when over one of its projects or tasks', () => {
    expect(groupDropTarget(rows, 3, true)).toEqual({
      index: 1,
      indicatorRowIndex: 3,
      edge: 'bottom',
    });
  });

  it('inserts at the end when over the last (collapsed) group', () => {
    expect(groupDropTarget(rows, 6, false)).toEqual({
      index: 3,
      indicatorRowIndex: 6,
      edge: 'bottom',
    });
  });
});
