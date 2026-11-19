import { describe, expect, it } from 'vitest';
import { groupOrderAfterMove, projectPlacementAfterMove } from './group-drop-target';
import type { SidebarRow } from './sidebar-store';

// Folded for a project drag: 0 p-ungrouped | 1 [A] | 2 p-a1 | 3 p-a2 | 4 [B] | 5 [C] | 6 p-c
const rows: SidebarRow[] = [
  { kind: 'project', projectId: 'p-ungrouped' },
  { kind: 'group', groupId: 'A' },
  { kind: 'project', projectId: 'p-a1' },
  { kind: 'project', projectId: 'p-a2' },
  { kind: 'group', groupId: 'B' },
  { kind: 'group', groupId: 'C' },
  { kind: 'project', projectId: 'p-c' },
];

describe('groupOrderAfterMove', () => {
  // Folded for a group drag: 0 p | 1 [A] | 2 [B] | 3 [C]
  const folded: SidebarRow[] = [
    { kind: 'project', projectId: 'p' },
    { kind: 'group', groupId: 'A' },
    { kind: 'group', groupId: 'B' },
    { kind: 'group', groupId: 'C' },
  ];

  it('moves a group down past others', () => {
    expect(groupOrderAfterMove(folded, 1, 3)).toEqual(['B', 'C', 'A']);
  });

  it('moves a group up to first', () => {
    expect(groupOrderAfterMove(folded, 3, 1)).toEqual(['C', 'A', 'B']);
  });

  it('keeps the order when nothing moves', () => {
    expect(groupOrderAfterMove(folded, 2, 2)).toEqual(['A', 'B', 'C']);
  });
});

describe('projectPlacementAfterMove', () => {
  it('reorders within a group', () => {
    expect(projectPlacementAfterMove(rows, 2, 3)).toEqual({ groupId: 'A', index: 1 });
  });

  it('moves into the group under the header it lands below', () => {
    expect(projectPlacementAfterMove(rows, 0, 1)).toEqual({ groupId: 'A', index: 0 });
    expect(projectPlacementAfterMove(rows, 2, 4)).toEqual({ groupId: 'B', index: 0 });
  });

  it('moves into a following group after its projects', () => {
    expect(projectPlacementAfterMove(rows, 0, 6)).toEqual({ groupId: 'C', index: 1 });
  });

  it('ungroups when moved above the first group', () => {
    expect(projectPlacementAfterMove(rows, 3, 1)).toEqual({ groupId: null, index: 1 });
    expect(projectPlacementAfterMove(rows, 6, 0)).toEqual({ groupId: null, index: 0 });
  });

  it('ignores moves of anything but a project', () => {
    expect(projectPlacementAfterMove(rows, 1, 0)).toBeNull();
  });
});
