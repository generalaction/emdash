/**
 * Thin caching layer around pretext's `prepareRichInline`.
 *
 * Pretext's prepare calls are deterministic but not cheap, so we memoize
 * by a stable cache key. The cache is invalidated whenever fonts load or
 * the container width changes (both of which can shift glyph metrics).
 */

import { clearCache as clearPretextInternalCaches } from '@chenglou/pretext';
import {
  type PreparedRichInline,
  type RichInlineItem,
  prepareRichInline,
} from '@chenglou/pretext/rich-inline';

/**
 * Cache key for a RichInlineItem[].
 *
 * Uses manual concatenation with control-character separators instead of
 * JSON.stringify to avoid the Object.keys + serialisation cost that appeared
 * hot in performance traces. The separator (\x00) cannot appear in any
 * font string or text, so the key is collision-free.
 */
function itemsKey(items: RichInlineItem[]): string {
  let key = '';
  for (const item of items) {
    key += item.font;
    key += '\x00';
    key += item.text;
    key += '\x00';
    if (item.break) key += item.break;
    key += '\x00';
    if (item.extraWidth !== undefined) key += item.extraWidth;
    key += '\x01'; // item separator
  }
  return key;
}

type CacheEntry = {
  prepared: PreparedRichInline;
};

const richInlineCache = new Map<string, CacheEntry>();

/**
 * Return a cached `PreparedRichInline` for `items`.
 * The prepared object is stable as long as the items are equal.
 */
export function getPreparedRichInline(items: RichInlineItem[]): PreparedRichInline {
  const key = itemsKey(items);
  let entry = richInlineCache.get(key);
  if (!entry) {
    entry = { prepared: prepareRichInline(items) };
    richInlineCache.set(key, entry);
  }
  return entry.prepared;
}

/**
 * Drop all cached prepared text — must be called when fonts or width changes.
 *
 * Also flushes pretext's *internal* module-level caches (per-font segment
 * widths, line-text, analysis). pretext memoizes `ctx.measureText` results
 * keyed only by the font string, with no font-load awareness: if the first
 * measurement happens before the named webfont loads, it permanently caches
 * the fallback-font widths. Clearing only `richInlineCache` re-prepares the
 * same items but still reads those stale widths, so the bubble stays sized for
 * the fallback metrics and the text overflows once the real font paints.
 */
export function clearPretextCache(): void {
  richInlineCache.clear();
  clearPretextInternalCaches();
}

/**
 * Named font faces to pre-load.  These must exactly match the font-family names
 * used in metrics.ts so `document.fonts.load()` resolves them correctly.
 */
const FONT_LOAD_SPECS = [
  '400 14px "Inter Variable"',
  '700 14px "Inter Variable"',
  '400 12px "Cascadia Code"',
  '500 12px "Cascadia Code"',
];

/**
 * Eagerly load the bundled named fonts, then clear pretext caches and call
 * `onCleared` (typically `virtualizer.measure()`).
 *
 * Using `document.fonts.load(spec)` instead of `document.fonts.ready` ensures
 * we wait for the exact faces pretext needs, not just "all fonts document-wide".
 * Without this, pretext measures with the fallback metrics during first paint
 * and produces wrong line-break positions until the cache is cleared.
 *
 * Call this once when ChatTranscript mounts.
 */
export function registerFontsReadyClear(onCleared?: () => void): void {
  if (typeof document === 'undefined') return;
  void Promise.all(FONT_LOAD_SPECS.map((spec) => document.fonts.load(spec))).then(() => {
    clearPretextCache();
    onCleared?.();
  });
}
