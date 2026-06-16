/**
 * Shiki highlighter singleton for the built-in code block renderer.
 *
 * Uses `createHighlighterCoreSync` + `createJavaScriptRegexEngine` so there is
 * no WebAssembly dependency and no async initialisation. The highlighter is
 * constructed lazily on the first call to `highlightCode`.
 *
 * Results are stored in a bounded LRU cache (keyed by `lang\x00code`).
 * `peekHighlight` does a cache-only lookup, letting the renderer take a
 * synchronous fast-path on scroll-back re-mounts without triggering parsing.
 */

import bash from '@shikijs/langs/bash';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import python from '@shikijs/langs/python';
import typescript from '@shikijs/langs/typescript';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single token within a highlighted line. */
export type CodeToken = {
  content: string;
  /** CSS custom-property declarations, e.g. { '--shiki-light': '#..', '--shiki-dark': '#..' } */
  htmlStyle?: Record<string, string>;
};

/** Result of highlighting a code block. */
export type HighlightResult = {
  /**
   * Inline style string to set on the block wrapper to supply the background
   * CSS vars: `--shiki-light-bg` and `--shiki-dark-bg`.
   */
  rootStyle: string;
  /** Per-line token arrays. Length matches the number of `\n`-split lines. */
  lines: CodeToken[][];
};

// ── Language alias map ────────────────────────────────────────────────────────

const SUPPORTED_LANGS = new Set(['typescript', 'javascript', 'python', 'json', 'bash']);

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  jsonc: 'json',
  json5: 'json',
};

function resolveAlias(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const lower = lang.toLowerCase();
  return LANG_ALIASES[lower] ?? (SUPPORTED_LANGS.has(lower) ? lower : undefined);
}

// ── Bounded LRU cache ─────────────────────────────────────────────────────────

const CACHE_MAX = 200;
const highlightCache = new Map<string, HighlightResult>();

function cacheKey(code: string, resolvedLang: string): string {
  return `${resolvedLang}\x00${code}`;
}

function cacheGet(key: string): HighlightResult | undefined {
  const val = highlightCache.get(key);
  if (val) {
    // Move to end (most-recently-used).
    highlightCache.delete(key);
    highlightCache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: HighlightResult): void {
  if (highlightCache.size >= CACHE_MAX) {
    // Evict the least-recently-used (first) entry.
    highlightCache.delete(highlightCache.keys().next().value!);
  }
  highlightCache.set(key, val);
}

// ── Highlighter singleton ─────────────────────────────────────────────────────

type SyncHighlighter = ReturnType<typeof createHighlighterCoreSync>;
let _highlighter: SyncHighlighter | null = null;

function getHighlighter(): SyncHighlighter {
  if (!_highlighter) {
    _highlighter = createHighlighterCoreSync({
      engine: createJavaScriptRegexEngine(),
      langs: [typescript, javascript, python, json, bash],
      themes: [githubLight, githubDark],
    });
  }
  return _highlighter;
}

// ── Token extraction ──────────────────────────────────────────────────────────

function computeHighlight(code: string, resolvedLang: string): HighlightResult {
  const hl = getHighlighter();
  const result = hl.codeToTokens(code, {
    lang: resolvedLang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });

  const lines: CodeToken[][] = result.tokens.map((line) =>
    line.map((tok) => {
      const token: CodeToken = { content: tok.content };
      if (tok.htmlStyle && Object.keys(tok.htmlStyle).length > 0) {
        token.htmlStyle = tok.htmlStyle as Record<string, string>;
      }
      return token;
    })
  );

  // When using dual themes, result.bg is already a CSS string like
  // "--shiki-light-bg:#fff;--shiki-dark-bg:#24292e"
  const rootStyle = typeof result.bg === 'string' ? result.bg : '';

  return { rootStyle, lines };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute syntax-highlighted tokens for `code` in the given language.
 *
 * Triggers grammar initialisation on the first call (one-time synchronous cost).
 * Returns `null` for unknown / unsupported languages.
 * Results are stored in the bounded LRU cache.
 */
export function highlightCode(code: string, lang: string | undefined): HighlightResult | null {
  const resolved = resolveAlias(lang);
  if (!resolved) return null;

  const key = cacheKey(code, resolved);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const result = computeHighlight(code, resolved);
    cacheSet(key, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Cache-only lookup — never triggers grammar initialisation or tokenisation.
 *
 * Returns a previously cached result, or `null` if the block has not been
 * highlighted yet. Use this for the synchronous fast-path on scroll-back
 * re-mounts.
 */
export function peekHighlight(code: string, lang: string | undefined): HighlightResult | null {
  const resolved = resolveAlias(lang);
  if (!resolved) return null;
  return cacheGet(cacheKey(code, resolved)) ?? null;
}
