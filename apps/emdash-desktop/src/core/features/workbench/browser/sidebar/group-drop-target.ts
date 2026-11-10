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
