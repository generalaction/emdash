/**
 * HeightModel — single source of truth for row/block heights.
 *
 * Height = specForBlock(block).measure(block, ctx) for each block,
 *          summed with the flex-gap between visible blocks + bubble padding.
 *
 * The flex-gap model matches .chat-bubble { display:flex; gap: var(--chat-block-gap) }
 * in chat.css, which replaces the old per-block margin-bottom approach.
 *
 * Cache keys:
 *   Per-block  — `${blockId}|${collapsed}|${width}`
 *   Per-item   — `${itemId}|${width}|${collapseVersion}`
 */

import { makeAutoObservable } from 'mobx';
import { specForBlock } from '../blocks/block-spec';
import type { Block } from '../blocks/block-types';
import { parseBlocksCached } from '../blocks/parse-blocks';
import { BODY, BUBBLE_PAD_Y, MESSAGE_GAP } from '../metrics';
import type { ChatItem, ChatMessage, ChatToolCall } from '../model';
import type { ViewStateStore } from '../state/view-state-store';
import type { FontConfig } from './fonts';
import { DEFAULT_FONT_CONFIG } from './fonts';
import { clearPretextCache } from './pretext-cache';

type CacheKey = string;

function cacheKey(blockId: string, collapsed: boolean, width: number): CacheKey {
  return `${blockId}|${collapsed ? 1 : 0}|${width}`;
}

export class HeightModel {
  private readonly fonts: FontConfig;
  /** DOM-measured heights for island blocks, set via setMeasured(). */
  private readonly measured = new Map<string, number>();
  /** Per-block height cache keyed by (blockId, collapsed, width). */
  private readonly cache = new Map<CacheKey, number>();
  /** Per-item total height cache keyed by (itemId, width, collapseVersion). */
  private readonly itemCache = new Map<string, number>();
  private _width = 0;

  constructor(fonts: FontConfig = DEFAULT_FONT_CONFIG) {
    this.fonts = fonts;
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get width(): number {
    return this._width;
  }

  /**
   * Called when the container width changes.
   * Width changes require re-measuring prose line-breaks, so all caches are cleared.
   */
  resetForWidth(newWidth: number): void {
    if (this._width === newWidth) return;
    this._width = newWidth;
    this.cache.clear();
    this.itemCache.clear();
    clearPretextCache();
  }

  /**
   * Write back a DOM-measured height for an island block (ResizeObserver path).
   * Clears the item cache so the virtualizer receives the corrected estimate
   * on the next `estimateSize` call.
   *
   * Returns `true` only when the height actually changed. Callers MUST gate any
   * follow-up work (e.g. virtualizer.measure()) on this so a stable height does
   * not retrigger a render → ref → measure loop ("Maximum update depth exceeded").
   * getBoundingClientRect can report subpixel-jittered values across reflows, so
   * we round to the nearest 0.5px before comparing to absorb that noise.
   */
  setMeasured(blockId: string, height: number): boolean {
    const rounded = Math.round(height * 2) / 2;
    const prev = this.measured.get(blockId);
    if (prev === rounded) return false;
    this.measured.set(blockId, rounded);
    // Invalidate per-block cache entries for this block
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${blockId}|`)) this.cache.delete(key);
    }
    // Island change → clear full item cache (islands are infrequent)
    this.itemCache.clear();
    return true;
  }

  /** Height of a single block in pixels (content + internal chrome, no gap). */
  blockHeight(block: Block, collapsed: boolean): number {
    const key = cacheKey(block.id, collapsed, this._width);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const h = specForBlock(block).measure(block, {
      width: this._width,
      fonts: this.fonts,
      collapsed,
      measured: this.measured.get(block.id),
    });

    this.cache.set(key, h);
    return h;
  }

  /**
   * Total height for one virtualised row (a `ChatItem`).
   *
   * Formula (message):
   *   2 × bubblePadY  +  Σ blockHeight(visible)  +  (visibleCount − 1) × blockGap  +  MESSAGE_GAP
   *
   * This mirrors .chat-bubble { display:flex; gap: var(--chat-block-gap) } precisely.
   */
  itemHeight(item: ChatItem, viewState: ViewStateStore): number {
    if (item.kind === 'tool') return this.toolRowHeight(item);

    // Item-total cache: O(1) during scroll
    const iKey = `${item.id}|${this._width}|${viewState.collapseVersion}`;
    const iCached = this.itemCache.get(iKey);
    if (iCached !== undefined) return iCached;

    const blocks = parseBlocksCached(item.id, item.text);
    const h = this.sumItemHeight(blocks, viewState);
    this.itemCache.set(iKey, h);
    return h;
  }

  private sumItemHeight(blocks: Block[], viewState: ViewStateStore): number {
    if (blocks.length === 0) {
      return this.fonts.body.lineHeight + 2 * this.fonts.bubblePadY + MESSAGE_GAP;
    }

    let visibleCount = 0;
    let contentHeight = 0;

    for (const block of blocks) {
      const collapsed = viewState.isCollapsed(block.id);
      const h = this.blockHeight(block, collapsed);
      if (h > 0) {
        contentHeight += h;
        visibleCount += 1;
      }
    }

    const gapTotal = visibleCount > 1 ? (visibleCount - 1) * this.fonts.blockGap : 0;
    return 2 * this.fonts.bubblePadY + contentHeight + gapTotal + MESSAGE_GAP;
  }

  /**
   * Fast O(text-length) height estimate that does NOT parse markdown or call pretext.
   * Used by `estimateSize` so TanStack Virtual does not pay for 10k markdown parses
   * at init.  The virtual rows are corrected to precise model heights as they mount
   * via `measureElement`.
   *
   * Strategy: split on hard newlines, assume each logical line wraps at
   * `charsPerLine` characters (derived from container width and body font size),
   * sum the resulting line count, scale by line-height, add chrome.
   */
  estimateItemHeight(item: ChatItem): number {
    if (item.kind === 'tool') return this.toolRowHeight(item);

    const msg = item as ChatMessage;
    // Tool calls from TranscriptStore have `.text`; guard against empty.
    if (!msg.text) return this.fonts.body.lineHeight + 2 * this.fonts.bubblePadY + MESSAGE_GAP;

    // Rough chars-per-line based on container width. BODY.fontSize ≈ px per char × 0.55 is a
    // reasonable Latin-text approximation; narrower avoids underestimating (causing jumps).
    const charsPerLine =
      this._width > 0 ? Math.max(20, Math.floor(this._width / (BODY.fontSize * 0.55))) : 60;

    let lineCount = 0;
    for (const paragraph of msg.text.split('\n')) {
      lineCount += Math.max(1, Math.ceil(paragraph.length / charsPerLine));
    }

    const contentHeight = lineCount * this.fonts.body.lineHeight;
    return 2 * BUBBLE_PAD_Y + contentHeight + MESSAGE_GAP;
  }

  private toolRowHeight(_item: ChatToolCall): number {
    return this.fonts.body.lineHeight + 8; // 4px top + 4px bottom padding in .chat-tool
  }
}
