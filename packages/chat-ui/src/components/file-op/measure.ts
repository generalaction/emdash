/**
 * measureFileOp — height function for ChatFileOpToolCall rows.
 *
 * Pure arithmetic, no pretext / DOM.
 *
 * Collapse semantics are inverted:
 *   isExpanded(id) maps to viewState.isCollapsed(id).
 *   Default absent/false → not expanded.
 *
 * FILEOP_PAD_Y and FILEOP_WINDOW_H come from file-op-metrics.ts (single source
 * of truth shared with the compose-tree def).
 * FILEOP_ROW_H and FILEOP_LINE_H both resolve to the shared ROW_H so the header
 * and every per-file row align to the same single-line rhythm.
 */

import { ROW_H } from '../../core/metrics';
import type { ChatFileOpToolCall } from '../../model';
import { FILEOP_PAD_Y, FILEOP_WINDOW_H } from './file-op-metrics';

export { FILEOP_PAD_Y, FILEOP_WINDOW_H };

export const FILEOP_ROW_H = ROW_H;
export const FILEOP_LINE_H = ROW_H;

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
