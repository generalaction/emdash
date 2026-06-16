/**
 * measureMessage — compute MessageLayout for a ChatMessage row.
 *
 * Thin wrapper around layoutMessage that connects it to component metrics
 * and the Solid view-state accessors.
 *
 * A module-level LRU-style cache stores the last `CACHE_MAX` layouts keyed by
 * `"${item.id}\x00${rowWidth}"`. The cache is bypassed (and computed fresh) for:
 *   - Streaming messages (text is still changing)
 *   - Any message with a collapsed block (collapse state is external)
 *   - Any message that has a DOM-measured island override (getMeasured returns a value)
 *
 * Call clearMessageLayoutCache() alongside clearPretextCache() on container
 * width changes so layouts are recomputed for the new line width.
 */

import { parseBlocksCached } from '../../core/blocks/parse-blocks';
import { layoutMessage } from '../../core/layout/layout-message';
import type { MessageLayout } from '../../core/layout/layout-types';
import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import type { FontConfig } from '../../core/measure/fonts';
import type { ChatMessage } from '../../model';

// ── Layout cache ──────────────────────────────────────────────────────────────

const CACHE_MAX = 500;

// Insertion-order map — we evict the oldest entry when over capacity.
const layoutCache = new Map<string, MessageLayout>();

export function clearMessageLayoutCache(): void {
  layoutCache.clear();
}

function cacheKey(id: string, rowWidth: number): string {
  return `${id}\x00${rowWidth}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function measureMessage(
  item: ChatMessage,
  rowWidth: number,
  fonts: FontConfig = DEFAULT_FONT_CONFIG,
  isCollapsed: (id: string) => boolean = () => false,
  getMeasured: (id: string) => number | undefined = () => undefined
): MessageLayout {
  const blocks = parseBlocksCached(item.id, item.text);

  // Determine if this layout is safe to cache:
  //  - Not streaming (text still growing)
  //  - No collapsed blocks (collapse is external state not in the key)
  //  - No DOM-measured island overrides (those change asynchronously)
  const isCacheable =
    !item.streaming &&
    !blocks.some((b) => isCollapsed(b.id)) &&
    !blocks.some((b) => b.tier === 'island' && getMeasured(b.id) !== undefined);

  if (isCacheable) {
    const key = cacheKey(item.id, rowWidth);
    const cached = layoutCache.get(key);
    if (cached) return cached;

    const layout = layoutMessage(blocks, rowWidth, fonts, isCollapsed, getMeasured, item.role);

    // Evict oldest entry if at capacity (Map preserves insertion order)
    if (layoutCache.size >= CACHE_MAX) {
      const firstKey = layoutCache.keys().next().value;
      if (firstKey !== undefined) layoutCache.delete(firstKey);
    }
    layoutCache.set(key, layout);
    return layout;
  }

  return layoutMessage(blocks, rowWidth, fonts, isCollapsed, getMeasured, item.role);
}
