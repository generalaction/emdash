/**
 * measureThinking — height for a ChatThinking row.
 *
 * Collapse semantics for thinking rows are inverted vs the store default:
 * isExpanded(id) is wired to viewState.isCollapsed(id) because "stored true"
 * means "user has expanded" (the default absent/false → preview or header-only).
 */

import { ROW_GAP } from '../../core/metrics';
import type { ChatThinking } from '../../model';
import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';

export function measureThinking(
  item: ChatThinking,
  isExpanded: (id: string) => boolean,
  measuredBodyHeight?: number
): number {
  if (!isExpanded(item.id)) {
    // Default / not expanded: active shows preview window, done shows header only.
    if (item.status === 'thinking') {
      return THINKING_HEADER_H + THINKING_WINDOW_H + ROW_GAP;
    }
    return THINKING_HEADER_H + ROW_GAP;
  }
  // Expanded (either status): header + measured prose body.
  return (
    THINKING_HEADER_H + 2 * THINKING_PAD_Y + (measuredBodyHeight ?? THINKING_WINDOW_H) + ROW_GAP
  );
}
