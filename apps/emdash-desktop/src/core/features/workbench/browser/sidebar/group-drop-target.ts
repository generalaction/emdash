import type { SidebarRow } from './sidebar-store';

export type GroupDropTarget = {
  /** Position in the group order to insert at, counted before the dragged group is removed. */
  index: number;
  /** Row the insertion line is drawn against. */
  indicatorRowIndex: number;
  edge: 'top' | 'bottom';
};

/**
 * Where a dragged group lands when the pointer is over `overRowIndex`.
 *
 * Groups move as whole sections, so the drop target is a section rather than a
 * row: the upper half of a group header means "before this group"; anywhere
 * else inside a group (lower half of its header, its projects or tasks) means
 * "after this group", drawn below the section's last row; the ungrouped
 * section above the first group means "first".
 */
export function groupDropTarget(
  rows: readonly SidebarRow[],
  overRowIndex: number,
  isAbove: boolean
): GroupDropTarget | null {
  const headerIndexes = rows.flatMap((row, i) => (row.kind === 'group' ? [i] : []));
  const firstHeader = headerIndexes[0];
  if (firstHeader === undefined) return null;

  let section = -1;
  for (let g = 0; g < headerIndexes.length; g++) {
    const header = headerIndexes[g];
    if (header !== undefined && header <= overRowIndex) section = g;
  }
  if (section === -1) return { index: 0, indicatorRowIndex: firstHeader, edge: 'top' };

  const header = headerIndexes[section] ?? firstHeader;
  if (overRowIndex === header && isAbove) {
    return { index: section, indicatorRowIndex: header, edge: 'top' };
  }
  const sectionEnd = (headerIndexes[section + 1] ?? rows.length) - 1;
  return { index: section + 1, indicatorRowIndex: sectionEnd, edge: 'bottom' };
}

export type ProjectDropTarget = {
  /** Group to place the project in; `null` for the ungrouped section. */
  groupId: string | null;
  /** Position among that section's projects, not counting the dragged project. */
  index: number;
};

/**
 * Where a dragged project lands when the pointer is over `overRowIndex`.
 *
 * Dropping anywhere on a group header puts the project first in that group, so
 * a collapsed group can be targeted directly. Otherwise the project goes into
 * the section of the nearest group header above the insertion point.
 */
export function projectDropTarget(
  rows: readonly SidebarRow[],
  overRowIndex: number,
  isAbove: boolean,
  projectId: string
): ProjectDropTarget {
  const overRow = rows[overRowIndex];
  if (overRow?.kind === 'group') return { groupId: overRow.groupId, index: 0 };

  const insertionRowIndex = isAbove ? overRowIndex : overRowIndex + 1;
  let sectionStart = 0;
  let groupId: string | null = null;
  for (let i = insertionRowIndex - 1; i >= 0; i--) {
    const row = rows[i];
    if (row?.kind === 'group') {
      sectionStart = i + 1;
      groupId = row.groupId;
      break;
    }
  }
  const index = rows
    .slice(sectionStart, insertionRowIndex)
    .filter((r) => r.kind === 'project' && r.projectId !== projectId).length;
  return { groupId, index };
}
