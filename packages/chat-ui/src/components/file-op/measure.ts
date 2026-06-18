/**
 * measureFileOp — height function for ChatFileOpToolCall rows.
 *
 * Pure arithmetic, no pretext / DOM.
 *
 * Collapse semantics are inverted:
 *   isExpanded(id) maps to viewState.isCollapsed(id).
 *   Default absent/false → not expanded.
 */

import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import type { ChatFileOpToolCall } from '../../model';

export const FILEOP_ROW_H = DEFAULT_FONT_CONFIG.body.lineHeight + 8;
export const FILEOP_LINE_H = DEFAULT_FONT_CONFIG.body.lineHeight;
export const FILEOP_PAD_Y = 6;
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
