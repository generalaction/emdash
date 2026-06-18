/**
 * Shiki highlighter singleton for the built-in code block renderer.
 *
 * Uses `createHighlighterCoreSync` + `createJavaScriptRegexEngine` so there is
 * no WebAssembly dependency and no async initialisation. The highlighter is
 * constructed lazily on the first call to `computeHighlightRaw`.
 *
 * This module exports only pure / stateless helpers:
 *   computeHighlightRaw  — tokenise code for a resolved language (no cache)
 *   resolveAlias         — normalise a lang string to a supported language name
 *
 * Caching (highlight LRU, peekHighlight) lives in ChatCaches (core/caches.ts)
 * so each mounted ChatRoot instance owns an isolated cache.
 */

import bash from '@shikijs/langs/bash';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import python from '@shikijs/langs/python';
import typescript from '@shikijs/langs/typescript';
import type { ThemeRegistrationRaw } from 'shiki/core';
import { SHIKI_THEME_MAP } from '@emdash/ui/theme/shiki-themes';
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

export function resolveAlias(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const lower = lang.toLowerCase();
  return LANG_ALIASES[lower] ?? (SUPPORTED_LANGS.has(lower) ? lower : undefined);
}

// ── Highlighter singleton ─────────────────────────────────────────────────────

type SyncHighlighter = ReturnType<typeof createHighlighterCoreSync>;
let _highlighter: SyncHighlighter | null = null;

function getHighlighter(): SyncHighlighter {
  if (!_highlighter) {
    _highlighter = createHighlighterCoreSync({
      engine: createJavaScriptRegexEngine(),
      langs: [typescript, javascript, python, json, bash],
      // Use generated emdash themes for consistent palette with the app chrome.
      // Cast needed because the generated `as const` makes arrays readonly; Shiki expects mutable.
      themes: [
        SHIKI_THEME_MAP.light as unknown as ThemeRegistrationRaw,
        SHIKI_THEME_MAP.dark as unknown as ThemeRegistrationRaw,
      ],
    });
  }
  return _highlighter;
}

// ── Token extraction ──────────────────────────────────────────────────────────

/**
 * Tokenise `code` using Shiki for the given resolved language.
 * Pure — no internal cache. Caching is handled by ChatCaches in core/caches.ts.
 */
export function computeHighlightRaw(code: string, resolvedLang: string): HighlightResult {
  const hl = getHighlighter();
  // Map keys 'light'/'dark' control the CSS var suffix: --shiki-light and --shiki-dark.
  // Code.tsx and diff.module.css consume those exact vars via .emdark: variant classes.
  // The values 'em-light'/'em-dark' are the registered theme names from SHIKI_THEME_MAP.
  const result = hl.codeToTokens(code, {
    lang: resolvedLang,
    themes: { light: 'em-light', dark: 'em-dark' },
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
