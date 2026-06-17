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
 *
 * Shared helpers:
 *   buildThinkingBlocks  — parse + normalise markdown into a Block[].
 *   layoutThinkingBody   — run layoutBlocks with thinking-specific opts.
 * Both are used by measureThinking for the preview and the expanded body so the
 * two paths cannot drift from each other.
 */

import type { Block } from '../../core/blocks/block-types';
import {
  downgradeIslandsToText,
  flattenHeadings,
  parseBlocksCached,
} from '../../core/blocks/parse-blocks';
import type { FontConfig } from '../../core/measure/fonts';
import { ROW_INSET_X } from '../../core/metrics';
import type { ChatThinking } from '../../model';
import { BLOCK_GAP, PROSE_GAP } from '../message/metrics';
import type { BlocksLayout } from '../rich-text/layout';
import { layoutBlocks } from '../rich-text/layout';
import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';

export type ThinkingMeasureResult = {
  height: number;
  /** Pre-computed layout for the expanded body (present only when expanded). */
  body?: BlocksLayout;
  /** Pre-computed layout for the active preview scroll window (present only when thinking + not expanded). */
  preview?: BlocksLayout;
};

// ── Shared helpers ────────────────────────────────────────────────────────────

export function buildThinkingBlocks(item: ChatThinking): Block[] {
  return downgradeIslandsToText(flattenHeadings(parseBlocksCached(item.id, item.text ?? '')));
}

export function layoutThinkingBody(
  blocks: Block[],
  fonts: FontConfig,
  rowWidth: number
): BlocksLayout {
  const bodyWidth = rowWidth - 2 * ROW_INSET_X;
  return layoutBlocks(blocks, bodyWidth, fonts, {
    padY: THINKING_PAD_Y,
    blockGap: BLOCK_GAP,
    proseGap: PROSE_GAP,
    getMeasured: () => undefined,
  });
}

// ── Exported functions ────────────────────────────────────────────────────────

export function estimateThinking(
  item: ChatThinking,
  isExpanded: (id: string) => boolean,
  fonts: FontConfig
): number {
  if (!isExpanded(item.id)) {
    // Default / not expanded: active shows preview window, done shows header only.
    if (item.status === 'thinking') {
      return THINKING_HEADER_H + THINKING_WINDOW_H;
    }
    return THINKING_HEADER_H;
  }
  // Cheap character-count estimate for the O(1) fast path.
  const lines = Math.max(1, Math.ceil((item.text?.length ?? 0) / 60));
  return THINKING_HEADER_H + 2 * THINKING_PAD_Y + lines * fonts.body.lineHeight;
}

export function measureThinking(
  item: ChatThinking,
  isExpanded: (id: string) => boolean,
  fonts: FontConfig,
  rowWidth: number
): ThinkingMeasureResult {
  if (!isExpanded(item.id)) {
    const height = estimateThinking(item, isExpanded, fonts);
    if (item.status === 'thinking') {
      // Compute the prose layout for the preview scroll window.
      // The row height is NOT derived from this layout (window clips/scrolls).
      const blocks = buildThinkingBlocks(item);
      const preview = layoutThinkingBody(blocks, fonts, rowWidth);
      return { height, preview };
    }
    return { height };
  }

  // Expanded: lay out the full body via pretext (DOM-free arithmetic).
  const blocks = buildThinkingBlocks(item);
  const body = layoutThinkingBody(blocks, fonts, rowWidth);
  return { height: THINKING_HEADER_H + body.height, body };
}
