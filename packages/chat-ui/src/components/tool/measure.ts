/**
 * measureTool — constant height for ChatToolCall rows.
 *
 * Returns content height only; Row.tsx adds the per-kind wrapper padding.
 */

import type { ChatToolCall } from '../../model';
import { TOOL_ROW_H } from './metrics';

export function measureTool(_item: ChatToolCall): number {
  return TOOL_ROW_H;
}
