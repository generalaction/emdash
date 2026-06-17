/**
 * measureTool — height estimate for a ChatToolCall row.
 *
 * Tool rows are flex-based (no pretext geometry), so we use a fixed estimate.
 * If detail is expanded, add the detail section height.
 */

import { BODY, ROW_GAP } from '../../core/metrics';
import type { ChatToolCall } from '../../model';
import { TOOL_ROW_H } from './metrics';

const DETAIL_LINE_H = BODY.lineHeight; // px per line of detail text
const DETAIL_LINES_EST = 3; // assume ~3 lines for detail when shown

export function measureTool(item: ChatToolCall, isCollapsed: (id: string) => boolean): number {
  const collapsed = isCollapsed(item.id);
  const base = TOOL_ROW_H + ROW_GAP;
  if (!item.detail || collapsed) return base;
  return base + DETAIL_LINE_H * DETAIL_LINES_EST + 12; // 12px padding
}
