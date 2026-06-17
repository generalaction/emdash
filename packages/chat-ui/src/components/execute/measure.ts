/**
 * measureExecute — height function for ChatExecute rows.
 *
 * Pure arithmetic, no pretext / DOM.
 * Both estimate() and measure() in spec.tsx call this directly.
 *
 * Collapse semantics are inverted (same convention as file-op and thinking rows):
 *   isExpanded(id) maps to viewState.isCollapsed(id).
 *   Default absent/false → not expanded.
 *
 * Height table:
 *   collapsed (running or done):
 *     EXEC_ROW_H + ROW_GAP
 *   expanded (no output yet):
 *     EXEC_ROW_H + 1 * EXEC_LINE_H + 2 * EXEC_PAD_Y + ROW_GAP
 *   expanded with output:
 *     EXEC_ROW_H + min(lines, EXEC_MAX_LINES) * EXEC_LINE_H + 2 * EXEC_PAD_Y + ROW_GAP
 */

import { ROW_GAP } from '../../core/metrics';
import type { ChatExecute } from '../../model';
import { EXEC_LINE_H, EXEC_MAX_LINES, EXEC_PAD_Y, EXEC_ROW_H } from './metrics';

export function measureExecute(item: ChatExecute, isExpanded: (id: string) => boolean): number {
  if (!isExpanded(item.id)) return EXEC_ROW_H + ROW_GAP;
  const lines = item.output ? item.output.split('\n').length : 1;
  const body = Math.min(lines, EXEC_MAX_LINES) * EXEC_LINE_H + 2 * EXEC_PAD_Y;
  return EXEC_ROW_H + body + ROW_GAP;
}
