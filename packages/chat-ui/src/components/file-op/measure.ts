/**
 * measureFileOp — pure height function for ChatFileOpToolCall rows.
 *
 * Constants are now declared in `fileOpUnitDef.vars` (single source of truth).
 * This module exists for node-environment unit tests; it mirrors the logic
 * in `file-op.def.tsx` without importing JSX dependencies.
 *
 * Collapse semantics are inverted:
 *   isExpanded(id) maps to viewState.isCollapsed(id).
 *   Default absent/false → not expanded.
 */

import type { ChatFileOpToolCall } from '../../model';

/** Mirrors fileOpUnitDef.vars.rowH (32px). */
export const FILEOP_ROW_H = 32;
/** Mirrors fileOpUnitDef.vars.rowH for per-file lines (same as header). */
export const FILEOP_LINE_H = 32;
/** Mirrors fileOpUnitDef.vars.padY (6px). */
export const FILEOP_PAD_Y = 6;
/** Mirrors fileOpUnitDef.vars.windowH (72px). */
export const FILEOP_WINDOW_H = 72;

export function measureFileOp(
  item: ChatFileOpToolCall,
  isExpanded: (id: string) => boolean
): number {
  if (item.ops.length <= 1) return FILEOP_ROW_H;

  if (isExpanded(item.id)) {
    return FILEOP_ROW_H + item.ops.length * FILEOP_LINE_H + 2 * FILEOP_PAD_Y;
  }

  if (item.status === 'running') return FILEOP_ROW_H + FILEOP_WINDOW_H;

  return FILEOP_ROW_H;
}
