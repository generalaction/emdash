/**
 * ChatCaches — per-ChatRoot instance data caches.
 *
 * Each mounted ChatRoot creates its own bundle via `createChatCaches()`.
 * The bundle owns four Map-backed caches (blocks, rich-inline text, syntax
 * highlight tokens, and diff rows) so different instances never share mutable
 * state and teardown is a single `caches.clear()` call.
 *
 * Distribution of global vs instance-scoped state
 * ─────────────────────────────────────────────────
 * Stays global (intentional):
 *   _highlighter (Shiki engine)  — stateless, expensive one-time init.
 *   nodeMemo / blockMemo         — WeakMap keyed by object identity, GC'd.
 *   pretext internal caches      — third-party global; flushed via clearTextMeasure().
 *   SUPPORTED_LANGS etc.         — immutable constants.
 *
 * Moved to per-instance (this file):
 *   blockCache       — string-keyed by messageId; unbounded; conflict vector.
 *   richInlineCache  — content-keyed; was unbounded.
 *   highlightCache   — content-keyed; bounded LRU 200, but leaked across instances.
 *   diffCache        — content-keyed; bounded LRU 100, but leaked across instances.
 *
 * ── Reaching the bundle ──────────────────────────────────────────────────────
 * Two execution contexts need caches:
 *   Measure path  — has MeasureCtx → add ctx.caches.
 *   Render leaves — Solid components deep in Project → add CachesContext + useCaches().
 */

import { clearCache as clearPretextInternalCaches } from '@chenglou/pretext';
import {
  type PreparedRichInline,
  type RichInlineItem,
  prepareRichInline as rawPrepareRichInline,
} from '@chenglou/pretext/rich-inline';
import { computeDiffRows } from '../components/diff/diff-lines';
import type { DiffRow } from '../components/diff/diff-lines';
import { computeHighlightRaw, resolveAlias } from './highlight/highlighter';
import type { HighlightResult } from './highlight/highlighter';
import type { Block } from './markdown/document';
import { parseMarkdownToBlocks } from './markdown/parse';

// ── Cache key helpers ─────────────────────────────────────────────────────────

/**
 * Content-addressable key for a RichInlineItem[].
 * Uses control-character separators to avoid collision and stay fast.
 */
function richInlineKey(items: RichInlineItem[]): string {
  let key = '';
  for (const item of items) {
    key += item.font;
    key += '\x00';
    key += item.text;
    key += '\x00';
    if (item.break) key += item.break;
    key += '\x00';
    if (item.extraWidth !== undefined) key += item.extraWidth;
    key += '\x01';
  }
  return key;
}

// ── LRU helpers ───────────────────────────────────────────────────────────────

function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const val = cache.get(key);
  if (val !== undefined) {
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

function lruSet<V>(cache: Map<string, V>, key: string, val: V, maxSize: number): void {
  if (cache.size >= maxSize) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, val);
}

// ── ChatCaches ────────────────────────────────────────────────────────────────

export type ChatCaches = {
  /** Parse markdown into a Block[] with identity-stable caching per messageId. */
  parseBlocks(id: string, markdown: string): Block[];
  /** Drop the cached blocks for one message (call after text is frozen). */
  evictBlocks(id: string): void;
  /** Return a cached PreparedRichInline for items; computes and caches on miss. */
  prepareRichInline(items: RichInlineItem[]): PreparedRichInline;
  /**
   * Syntax-highlight code; returns null for unsupported languages.
   * Caches result in a bounded LRU (200 entries).
   */
  highlight(code: string, lang: string | undefined): HighlightResult | null;
  /**
   * Cache-only highlight lookup; never triggers parsing.
   * Use for the synchronous fast-path on scroll-back re-mounts.
   */
  peekHighlight(code: string, lang: string | undefined): HighlightResult | null;
  /** Compute a line-level diff with bounded LRU caching (100 entries). */
  computeDiff(oldText: string | null, newText: string): DiffRow[];
  /**
   * Drop the rich-inline text cache and flush pretext's internal global caches.
   * Call on container-width changes and after fonts load.
   */
  clearTextMeasure(): void;
  /** Drop all caches. Call when the ChatRoot unmounts. */
  clear(): void;
};

const HIGHLIGHT_CACHE_MAX = 200;
const DIFF_CACHE_MAX = 100;

export function createChatCaches(): ChatCaches {
  // Block parse cache — keyed by messageId.
  const blockCache = new Map<string, { text: string; blocks: Block[] }>();

  // Rich-inline text measurement cache — keyed by content.
  const richInlineCache = new Map<string, PreparedRichInline>();

  // Syntax highlight LRU — keyed by `${resolvedLang}\x00${code}`.
  const highlightCache = new Map<string, HighlightResult>();

  // Diff LRU — keyed by `${oldText ?? '\x00null'}\x00${newText}`.
  const diffCache = new Map<string, DiffRow[]>();

  function diffKey(oldText: string | null, newText: string): string {
    return `${oldText ?? '\x00null'}\x00${newText}`;
  }

  return {
    parseBlocks(id, markdown) {
      const hit = blockCache.get(id);
      if (hit && hit.text === markdown) return hit.blocks;
      const blocks = parseMarkdownToBlocks(id, markdown);
      blockCache.set(id, { text: markdown, blocks });
      return blocks;
    },

    evictBlocks(id) {
      blockCache.delete(id);
    },

    prepareRichInline(items) {
      const key = richInlineKey(items);
      const cached = richInlineCache.get(key);
      if (cached) return cached;
      const prepared = rawPrepareRichInline(items);
      richInlineCache.set(key, prepared);
      return prepared;
    },

    highlight(code, lang) {
      const resolved = resolveAlias(lang);
      if (!resolved) return null;
      const key = `${resolved}\x00${code}`;
      const cached = lruGet(highlightCache, key);
      if (cached) return cached;
      try {
        const result = computeHighlightRaw(code, resolved);
        lruSet(highlightCache, key, result, HIGHLIGHT_CACHE_MAX);
        return result;
      } catch {
        return null;
      }
    },

    peekHighlight(code, lang) {
      const resolved = resolveAlias(lang);
      if (!resolved) return null;
      return lruGet(highlightCache, `${resolved}\x00${code}`) ?? null;
    },

    computeDiff(oldText, newText) {
      const key = diffKey(oldText, newText);
      const cached = lruGet(diffCache, key);
      if (cached) return cached;
      const result = computeDiffRows(oldText, newText);
      lruSet(diffCache, key, result, DIFF_CACHE_MAX);
      return result;
    },

    clearTextMeasure() {
      richInlineCache.clear();
      clearPretextInternalCaches();
    },

    clear() {
      blockCache.clear();
      richInlineCache.clear();
      highlightCache.clear();
      diffCache.clear();
    },
  };
}

// ── Module-level fallback ─────────────────────────────────────────────────────

/**
 * Lazily-created fallback bundle for call sites that are not under a
 * CachesContext.Provider (direct test/story mounts of leaf components).
 *
 * Not used in production ChatRoot mounts; each instance creates its own
 * bundle via `createChatCaches()` in ChatRoot.
 */
let _fallbackCaches: ChatCaches | null = null;

export function getFallbackCaches(): ChatCaches {
  if (!_fallbackCaches) _fallbackCaches = createChatCaches();
  return _fallbackCaches;
}
