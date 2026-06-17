/**
 * measureTool — constant height for ChatToolCall rows.
 *
 * The row is non-collapsible, so height is always TOOL_ROW_H + ROW_GAP.
 */

import { ROW_GAP } from '../../core/metrics';
import type { ChatToolCall } from '../../model';
import { TOOL_ROW_H } from './metrics';

export function measureTool(_item: ChatToolCall): number {
  return TOOL_ROW_H + ROW_GAP;
}
