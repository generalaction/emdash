import { arrayMove } from '@dnd-kit/sortable';
import type { SidebarRow } from './sidebar-store';

/**
 * Group order after the sortable list moves the header at `from` to `to`, as
 * the sliding rows show it. While a group is dragged every group is folded, so
 * the headers are contiguous and only move among each other.
 */
export function groupOrderAfterMove(
  rows: readonly SidebarRow[],
  from: number,
  to: number
): string[] {
  return arrayMove([...rows], from, to).flatMap((row) =>
    row.kind === 'group' ? [row.groupId] : []
  );
}

export type ProjectPlacement = {
  /** Group to place the project in; `null` for the ungrouped section. */
  groupId: string | null;
  /** Position among that section's projects, not counting the moved project. */
  index: number;
};

/**
 * Where a project lands after the sortable list moves its row from `from` to
 * `to`, as the sliding rows show it: in the section of the nearest group
 * header above it (none means ungrouped), after the projects between that
 * header and it. Moving above the first header ungroups the project.
 */
export function projectPlacementAfterMove(
  rows: readonly SidebarRow[],
  from: number,
  to: number
): ProjectPlacement | null {
  const moved = arrayMove([...rows], from, to);
  if (moved[to]?.kind !== 'project') return null;
  let groupId: string | null = null;
  let index = 0;
  for (let i = to - 1; i >= 0; i--) {
    const row = moved[i];
    if (row?.kind === 'group') {
      groupId = row.groupId;
      break;
    }
    if (row?.kind === 'project') index++;
  }
  return { groupId, index };
}
