/**
 * LayoutStore — MobX cache for MessageLayout objects.
 *
 * Cache key: `${itemId}|${width}|${collapseVersion}`
 */

import { makeAutoObservable } from 'mobx';
import { parseBlocksCached } from '../blocks/parse-blocks';
import { DEFAULT_FONT_CONFIG } from '../measure/fonts';
import type { FontConfig } from '../measure/fonts';
import { clearPretextCache } from '../measure/pretext-cache';
import {
  BODY,
  BUBBLE_PAD_Y,
  MESSAGE_GAP,
  THINKING_HEADER_H,
  THINKING_PAD_Y,
  THINKING_WINDOW_H,
} from '../metrics';
import type { ChatItem, ChatMessage, ChatThinking } from '../model';
import type { ViewStateStore } from '../state/view-state-store';
import { layoutMessage } from './layout-message';
import type { MessageLayout } from './layout-types';

export class LayoutStore {
  private readonly fonts: FontConfig;
  /** DOM-measured heights for island blocks and thinking bodies. */
  readonly measured = new Map<string, number>();
  /** MessageLayout cache keyed by `itemId|width|collapseVersion`. */
  private readonly cache = new Map<string, MessageLayout>();
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
   * Clears all layout caches and the pretext prepared-text cache so prose
   * line breaks are recomputed at the new width.
   */
  resetForWidth(newWidth: number): void {
    if (this._width === newWidth) return;
    this._width = newWidth;
    this.cache.clear();
    clearPretextCache();
  }

  /**
   * Evict all cached layouts for a given item.
   *
   * Called before re-querying `getLayout` for a streaming message whose text
   * has changed, so the stale cached layout (keyed by itemId|width|collapseVersion,
   * which does NOT include text content) is not returned.
   */
  invalidateItem(itemId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${itemId}|`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Write back a DOM-measured height for an island block or thinking body.
   * Invalidates cache entries for the owning item.
   */
  setMeasured(blockId: string, height: number): void {
    const prev = this.measured.get(blockId);
    if (prev === height) return;
    this.measured.set(blockId, height);
    // Invalidate all cached layouts containing this block id.
    // Islands and thinking bodies are rare so a full scan is acceptable.
    for (const key of this.cache.keys()) {
      const itemId = key.split('|')[0];
      // Block ids are either `${messageId}#${index}` or a plain thinking item id.
      const ownerId = blockId.includes('#') ? blockId.split('#')[0] : blockId;
      if (itemId === ownerId) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Return the full MessageLayout for a chat item.
   * - tool: cheap single-line height, no geometry.
   * - thinking: fixed height based on status + collapse state.
   * - message: full block layout via layoutMessage.
   */
  getLayout(item: ChatItem, viewState: ViewStateStore): MessageLayout {
    if (item.kind === 'tool') {
      return {
        height: this.fonts.body.lineHeight + 8,
        width: 0,
        blocks: [],
      };
    }

    if (item.kind === 'thinking') {
      return this._thinkingLayout(item, viewState);
    }

    const key = `${item.id}|${this._width}|${viewState.collapseVersion}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const msg = item as ChatMessage;
    const blocks = parseBlocksCached(item.id, msg.text);
    const layout = layoutMessage(
      blocks,
      this._width,
      this.fonts,
      viewState,
      this.measured,
      msg.role
    );
    this.cache.set(key, layout);
    return layout;
  }

  /**
   * Fast O(text-length) height estimate — no markdown parse, no pretext.
   * Used by `estimateSize` for offscreen rows.
   */
  estimateHeight(item: ChatItem): number {
    if (item.kind === 'tool') return this.fonts.body.lineHeight + 8;
    if (item.kind === 'thinking') {
      return this._thinkingLayout(item, {
        // Provide a minimal viewState proxy: thinking row defaults collapsed when done.
        isCollapsed: () => item.status === 'done',
        collapseVersion: 0,
      } as unknown as ViewStateStore).height;
    }
    const msg = item as ChatMessage;
    if (!msg.text) return this.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + MESSAGE_GAP;
    const charsPerLine =
      this._width > 0 ? Math.max(20, Math.floor(this._width / (BODY.fontSize * 0.55))) : 60;
    let lineCount = 0;
    for (const paragraph of msg.text.split('\n')) {
      lineCount += Math.max(1, Math.ceil(paragraph.length / charsPerLine));
    }
    return 2 * BUBBLE_PAD_Y + lineCount * this.fonts.body.lineHeight + MESSAGE_GAP;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _thinkingLayout(item: ChatThinking, viewState: ViewStateStore): MessageLayout {
    // The key for cache includes collapse version so expand/collapse gets the right height.
    const key = `${item.id}|${this._width}|${viewState.collapseVersion}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let height: number;

    if (item.status === 'thinking') {
      // Active: header + streaming window.
      height = THINKING_HEADER_H + THINKING_WINDOW_H + MESSAGE_GAP;
    } else {
      // Done: header only when collapsed (collapsed is the default for done items).
      const expanded = !viewState.isCollapsed(item.id);
      if (expanded) {
        const bodyH = this.measured.get(item.id) ?? THINKING_WINDOW_H;
        height = THINKING_HEADER_H + 2 * THINKING_PAD_Y + bodyH + MESSAGE_GAP;
      } else {
        height = THINKING_HEADER_H + MESSAGE_GAP;
      }
    }

    const layout: MessageLayout = { height, width: 0, blocks: [] };
    this.cache.set(key, layout);
    return layout;
  }
}
