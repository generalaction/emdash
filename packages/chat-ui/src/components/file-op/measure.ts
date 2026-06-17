/**
 * measureFileOp — height function for ChatFileOpToolCall rows.
 *
 * Pure arithmetic, no pretext / DOM. Constants from DEFAULT_THEME.geometry.
 *
 * Collapse semantics are inverted:
 *   isExpanded(id) maps to viewState.isCollapsed(id).
 *   Default absent/false → not expanded.
 */

import { DEFAULT_THEME } from '../../core/theme';
import type { ChatFileOpToolCall } from '../../model';

const {
  fileopRowH: FILEOP_ROW_H,
  fileopLineH: FILEOP_LINE_H,
  fileopPadY: FILEOP_PAD_Y,
  fileopWindowH: FILEOP_WINDOW_H,
} = DEFAULT_THEME.geometry;

export { FILEOP_ROW_H, FILEOP_LINE_H, FILEOP_PAD_Y, FILEOP_WINDOW_H };

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
