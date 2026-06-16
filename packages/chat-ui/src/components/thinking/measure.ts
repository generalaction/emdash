/**
 * Height functions for ChatThinking rows.
 *
 * Collapse semantics for thinking rows are inverted vs the store default:
 *   isExpanded(id) maps to viewState.isCollapsed(id) because "stored true"
 *   means "user has expanded" (the default absent/false → preview or header-only).
 *
 * estimateThinking — O(1) fast path used by the virtualizer estimate() call.
 * measureThinking  — full pretext layout for the expanded body; also O(1) for
 *                    the collapsed paths so spec.tsx can call it in measure() too.
 */

import {
  downgradeIslandsToText,
  flattenHeadings,
  parseBlocksCached,
} from '../../core/blocks/parse-blocks';
import type { FontConfig } from '../../core/measure/fonts';
import { ROW_GAP, ROW_INSET_X } from '../../core/metrics';
import type { ChatThinking } from '../../model';
import { BLOCK_GAP, PROSE_GAP } from '../message/metrics';
import type { BlocksLayout } from '../rich-text/layout';
import { layoutBlocks } from '../rich-text/layout';
import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';

export type ThinkingMeasureResult = { height: number; body?: BlocksLayout };

export function estimateThinking(
  item: ChatThinking,
  isExpanded: (id: string) => boolean,
  fonts: FontConfig
): number {
  if (!isExpanded(item.id)) {
    // Default / not expanded: active shows preview window, done shows header only.
    if (item.status === 'thinking') {
      return THINKING_HEADER_H + THINKING_WINDOW_H + ROW_GAP;
    }
    return THINKING_HEADER_H + ROW_GAP;
  }
  // Cheap character-count estimate for the O(1) fast path.
  const lines = Math.max(1, Math.ceil((item.text?.length ?? 0) / 60));
  return THINKING_HEADER_H + 2 * THINKING_PAD_Y + lines * fonts.body.lineHeight + ROW_GAP;
}

export function measureThinking(
  item: ChatThinking,
  isExpanded: (id: string) => boolean,
  fonts: FontConfig,
  rowWidth: number
): ThinkingMeasureResult {
  if (!isExpanded(item.id)) {
    return { height: estimateThinking(item, isExpanded, fonts) };
  }

  // Lay out the expanded body via pretext (DOM-free arithmetic).
  // Body spans the full row minus the padding on both sides.
  const bodyWidth = rowWidth - 2 * ROW_INSET_X;
  const blocks = downgradeIslandsToText(
    flattenHeadings(parseBlocksCached(item.id, item.text ?? ''))
  );
  const body = layoutBlocks(blocks, bodyWidth, fonts, {
    padY: THINKING_PAD_Y,
    blockGap: BLOCK_GAP,
    proseGap: PROSE_GAP,
    getMeasured: () => undefined,
  });

  return { height: THINKING_HEADER_H + body.height + ROW_GAP, body };
}
