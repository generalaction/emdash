/**
 * measureThinking — height for a ChatThinking row.
 */

import { ROW_GAP } from '../../core/metrics';
import type { ChatThinking } from '../../model';
import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';

export function measureThinking(
  item: ChatThinking,
  isCollapsed: (id: string) => boolean,
  measuredBodyHeight?: number
): number {
  if (item.status === 'thinking') {
    return THINKING_HEADER_H + THINKING_WINDOW_H + ROW_GAP;
  }
  if (isCollapsed(item.id)) {
    return THINKING_HEADER_H + ROW_GAP;
  }
  return (
    THINKING_HEADER_H + 2 * THINKING_PAD_Y + (measuredBodyHeight ?? THINKING_WINDOW_H) + ROW_GAP
  );
}
