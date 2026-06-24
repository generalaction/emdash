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
import { computeDiffRows } from '@components/rows/tools/diff/diff-lines';
import type { DiffRow } from '@components/rows/tools/diff/diff-lines';
import { renderMermaidSVG } from 'beautiful-mermaid';
import {
  createDefaultHighlighter,
  type ChatHighlighter,
  type HighlightResult,
} from './highlight/highlighter';
import type { Block } from './markdown/document';
import type { MentionProvider } from './markdown/mention-provider';
import { parseMarkdownToBlocks } from './markdown/parse';

// ── Streaming parse helpers ───────────────────────────────────────────────────
//
// Incremental (append-aware) streaming parser state. During streaming each new
// chunk re-parses only the "growing" tail (text after the last blank-line
// boundary that is not inside an open code fence). The settled prefix keeps its
// Block object identities across chunks so blockMemo (WeakMap-keyed by Block
// ref) hits for them — turning the O(n²) re-parse/re-measure/re-render into
// O(tail) per chunk.

type StreamingRecord = {
  /** Portion of the message text whose blocks are stable (object-identity-stable). */
  stableText: string;
  /** Parsed Block objects for stableText. Never mutated after creation. */
  stableBlocks: Block[];
  /** Next block counter value = stableBlocks.length. */
  counter: number;
};

/**
 * Returns true if `text` ends inside an open code fence (a line starting with
 * 3+ backticks or tildes). Used to avoid treating blank lines inside code blocks
 * as safe streaming-parse boundaries.
 */
function endsInsideFence(text: string): boolean {
  let inside = false;
  let i = 0;
  while (i < text.length) {
    const nlIdx = text.indexOf('\n', i);
    const lineEnd = nlIdx === -1 ? text.length : nlIdx;
    const line = text.slice(i, lineEnd);
    if (/^\s*(`{3,}|~{3,})/.test(line)) inside = !inside;
    if (nlIdx === -1) break;
    i = nlIdx + 1;
  }
  return inside;
}

/**
 * Returns the position in `tail` immediately after the last safe streaming
 * parse boundary — a blank line (`\n\n`) that is not inside an open code fence.
 * Returns 0 when no safe boundary exists (the entire tail is still growing).
 *
 * `stableText` is used to determine whether the start of `tail` is already
 * inside a code fence opened in the stable prefix.
 */
function findSafeStreamBoundary(stableText: string, tail: string): number {
  let inside = endsInsideFence(stableText);
  let lastSafe = 0;
  let i = 0;

  while (i < tail.length) {
    const nlIdx = tail.indexOf('\n', i);
    if (nlIdx === -1) break;
    const line = tail.slice(i, nlIdx);
    if (/^\s*(`{3,}|~{3,})/.test(line)) inside = !inside;
    // A blank line is detected when the character immediately after this \n is
    // also \n (making the sequence \n\n in the source).
    if (!inside && tail[nlIdx + 1] === '\n') {
      lastSafe = nlIdx + 2;
    }
    i = nlIdx + 1;
  }

  return lastSafe;
}

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
  /**
   * Incremental streaming parse — O(tail) per chunk instead of O(n²).
   *
   * Maintains a per-id streaming record that tracks the stable prefix (text
   * whose Block objects are reused across chunks so blockMemo hits for them).
   * Only the growing tail after the last blank-line boundary is re-parsed on
   * each chunk. Call this while `item.streaming === true`; switch to the normal
   * `parseBlocks` after the turn is frozen — that final call clears the record.
   *
   * Limitations (acceptable for chat use):
   *   - Non-append mutations (edit/replay) fall back to a full reparse.
   *   - Blank lines inside code fences are excluded from boundaries, but
   *     link-reference definitions and exotic loose-list continuations near
   *     a boundary may not parse identically in isolation vs. in context.
   */
  parseBlocksStreaming(id: string, markdown: string): Block[];
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
   * Render a Mermaid diagram source to an SVG string.
   * Returns null on invalid/unsupported input.
   * Caches result in a bounded LRU (100 entries).
   * Uses CSS-variable theming so a single cached SVG adapts to light/dark.
   */
  renderMermaid(source: string): string | null;
  /**
   * Cache-only Mermaid SVG lookup; never triggers rendering.
   * Use for the synchronous fast-path on scroll-back re-mounts.
   */
  peekMermaid(source: string): string | null;
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
const MERMAID_CACHE_MAX = 100;

export function createChatCaches(
  highlighter?: ChatHighlighter,
  mentionProvider?: MentionProvider
): ChatCaches {
  const hl = highlighter ?? createDefaultHighlighter();
  // Block parse cache — keyed by messageId.
  const blockCache = new Map<string, { text: string; blocks: Block[] }>();

  // Streaming parse records — keyed by messageId. Cleared when the non-streaming
  // parseBlocks path is taken (i.e. on turn freeze).
  const streamCache = new Map<string, StreamingRecord>();

  // Rich-inline text measurement cache — keyed by content.
  const richInlineCache = new Map<string, PreparedRichInline>();

  // Syntax highlight LRU — keyed by `${resolvedLang}\x00${code}`.
  const highlightCache = new Map<string, HighlightResult>();

  // Diff LRU — keyed by `${oldText ?? '\x00null'}\x00${newText}`.
  const diffCache = new Map<string, DiffRow[]>();

  // Mermaid SVG LRU — keyed by source text.
  const mermaidCache = new Map<string, string>();

  function diffKey(oldText: string | null, newText: string): string {
    return `${oldText ?? '\x00null'}\x00${newText}`;
  }

  return {
    parseBlocks(id, markdown) {
      // Clear any streaming record — this path is taken after turn freeze.
      streamCache.delete(id);
      const hit = blockCache.get(id);
      if (hit && hit.text === markdown) return hit.blocks;
      const blocks = parseMarkdownToBlocks(id, markdown, mentionProvider);
      blockCache.set(id, { text: markdown, blocks });
      return blocks;
    },

    parseBlocksStreaming(id, markdown) {
      if (!markdown.trim()) return [];

      let rec = streamCache.get(id);

      // If the text is not an append (edit/replay), reset and treat all content
      // as a fresh growing tail with no stable prefix.
      if (!rec || !markdown.startsWith(rec.stableText)) {
        rec = { stableText: '', stableBlocks: [], counter: 0 };
        streamCache.set(id, rec);
      }

      const tail = markdown.slice(rec.stableText.length);

      // Find the last blank-line boundary in the tail that is outside any open
      // code fence. Everything before it can be parsed as stable settled blocks.
      const boundary = findSafeStreamBoundary(rec.stableText, tail);

      if (boundary > 0) {
        // Parse the newly settled chunk and append to the stable prefix. These
        // blocks get object-stable identities on subsequent chunks (blockMemo hits).
        const settledChunk = tail.slice(0, boundary);
        const newBlocks = parseMarkdownToBlocks(id, settledChunk, mentionProvider, rec.counter);
        rec.stableBlocks = [...rec.stableBlocks, ...newBlocks];
        rec.stableText += settledChunk;
        rec.counter += newBlocks.length;
      }

      // Re-parse the still-growing tail (small; only content after boundary).
      const growingChunk = tail.slice(boundary);
      const growingBlocks = growingChunk.trim()
        ? parseMarkdownToBlocks(id, growingChunk, mentionProvider, rec.counter)
        : [];

      return growingBlocks.length > 0 ? [...rec.stableBlocks, ...growingBlocks] : rec.stableBlocks;
    },

    evictBlocks(id) {
      blockCache.delete(id);
      streamCache.delete(id);
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
      const key = `${lang ?? ''}\x00${code}`;
      const cached = lruGet(highlightCache, key);
      if (cached) return cached;
      try {
        const result = hl.highlight(code, lang);
        if (!result) return null;
        lruSet(highlightCache, key, result, HIGHLIGHT_CACHE_MAX);
        return result;
      } catch {
        return null;
      }
    },

    peekHighlight(code, lang) {
      return lruGet(highlightCache, `${lang ?? ''}\x00${code}`) ?? null;
    },

    computeDiff(oldText, newText) {
      const key = diffKey(oldText, newText);
      const cached = lruGet(diffCache, key);
      if (cached) return cached;
      const result = computeDiffRows(oldText, newText);
      lruSet(diffCache, key, result, DIFF_CACHE_MAX);
      return result;
    },

    renderMermaid(source) {
      const hit = lruGet(mermaidCache, source);
      if (hit !== undefined) return hit;
      try {
        // CSS variables as color values so a single cached SVG adapts to
        // light/dark mode without re-rendering.
        const svg = renderMermaidSVG(source, {
          transparent: true,
          bg: 'var(--chat-bg)',
          fg: 'var(--chat-fg)',
          line: 'var(--chat-fg-muted)',
          muted: 'var(--chat-fg-passive)',
          surface: 'var(--chat-bg-1)',
          border: 'var(--chat-border)',
        });
        lruSet(mermaidCache, source, svg, MERMAID_CACHE_MAX);
        return svg;
      } catch {
        return null;
      }
    },

    peekMermaid(source) {
      return mermaidCache.get(source) ?? null;
    },

    clearTextMeasure() {
      richInlineCache.clear();
      clearPretextInternalCaches();
    },

    clear() {
      blockCache.clear();
      streamCache.clear();
      richInlineCache.clear();
      highlightCache.clear();
      diffCache.clear();
      mermaidCache.clear();
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
