/**
 * measureFileOp — height function for ChatFileOpToolCall rows.
 *
 * Pure arithmetic, no pretext / DOM.
 * Both estimate() and measure() in spec.tsx call this directly.
 *
 * Collapse semantics are inverted (same convention as thinking rows):
 *   isExpanded(id) maps to viewState.isCollapsed(id).
 *   Default absent/false → not expanded.
 *
 * Height table:
 *   ops.length <= 1 (inline):
 *     FILEOP_ROW_H + ROW_GAP
 *   multi + expanded:
 *     FILEOP_ROW_H + ops.length * FILEOP_LINE_H + 2 * FILEOP_PAD_Y + ROW_GAP
 *   multi + collapsed + running (streaming preview):
 *     FILEOP_ROW_H + FILEOP_WINDOW_H + ROW_GAP
 *   multi + collapsed + settled:
 *     FILEOP_ROW_H + ROW_GAP
 */

import { ROW_GAP } from '../../core/metrics';
import type { ChatFileOpToolCall } from '../../model';
import { FILEOP_LINE_H, FILEOP_PAD_Y, FILEOP_ROW_H, FILEOP_WINDOW_H } from './metrics';

export function measureFileOp(
  item: ChatFileOpToolCall,
  isExpanded: (id: string) => boolean
): number {
  if (item.ops.length <= 1) return FILEOP_ROW_H + ROW_GAP;

  if (isExpanded(item.id)) {
    return FILEOP_ROW_H + item.ops.length * FILEOP_LINE_H + 2 * FILEOP_PAD_Y + ROW_GAP;
  }

  if (item.status === 'running') return FILEOP_ROW_H + FILEOP_WINDOW_H + ROW_GAP;

  return FILEOP_ROW_H + ROW_GAP;
}
