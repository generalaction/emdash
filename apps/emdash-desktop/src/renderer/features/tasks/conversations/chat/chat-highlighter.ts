/**
 * chat-highlighter.ts — app-singleton ChatHighlighter for emdash-desktop.
 *
 * Builds one Shiki instance for the renderer's lifetime, registered with the
 * emdash em-light and em-dark themes from @emdash/ui/theme/shiki-themes, and
 * wraps it as a ChatHighlighter to inject via the ChatTranscript prop.
 *
 * Using the app-managed singleton keeps Shiki initialization (regex engine,
 * theme + lang loading) at the call site that already controls the lifecycle,
 * and avoids a second identical singleton inside @emdash/chat-ui.
 */

import type { ChatHighlighter, HighlightResult } from '@emdash/chat-ui';
import { SHIKI_THEME_MAP } from '@emdash/ui/theme/shiki-themes';
import bash from '@shikijs/langs/bash';
import css from '@shikijs/langs/css';
import go from '@shikijs/langs/go';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import markdown from '@shikijs/langs/markdown';
import python from '@shikijs/langs/python';
import rust from '@shikijs/langs/rust';
import typescript from '@shikijs/langs/typescript';
import yaml from '@shikijs/langs/yaml';
import type { ThemeRegistrationRaw } from 'shiki/core';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const SUPPORTED_LANGS = new Set([
  'typescript',
  'javascript',
  'python',
  'json',
  'bash',
  'css',
  'go',
  'rust',
  'yaml',
  'markdown',
]);

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
  rs: 'rust',
  md: 'markdown',
};

function resolveAlias(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const lower = lang.toLowerCase();
  return LANG_ALIASES[lower] ?? (SUPPORTED_LANGS.has(lower) ? lower : undefined);
}

let _highlighter: ReturnType<typeof createHighlighterCoreSync> | null = null;

function getHighlighter() {
  if (!_highlighter) {
    _highlighter = createHighlighterCoreSync({
      engine: createJavaScriptRegexEngine(),
      langs: [typescript, javascript, python, json, bash, css, go, rust, yaml, markdown],
      themes: [
        SHIKI_THEME_MAP.light as unknown as ThemeRegistrationRaw,
        SHIKI_THEME_MAP.dark as unknown as ThemeRegistrationRaw,
      ],
    });
  }
  return _highlighter;
}

export const desktopChatHighlighter: ChatHighlighter = {
  highlight(code: string, lang: string | undefined): HighlightResult | null {
    const resolved = resolveAlias(lang);
    if (!resolved) return null;

    const hl = getHighlighter();
    const result = hl.codeToTokens(code, {
      lang: resolved,
      themes: { light: 'em-light', dark: 'em-dark' },
      defaultColor: false,
    });

    const lines = result.tokens.map((line) =>
      line.map((tok) => {
        const token: { content: string; htmlStyle?: Record<string, string> } = {
          content: tok.content,
        };
        if (tok.htmlStyle && Object.keys(tok.htmlStyle).length > 0) {
          token.htmlStyle = tok.htmlStyle as Record<string, string>;
        }
        return token;
      })
    );

    const rootStyle = typeof result.bg === 'string' ? result.bg : '';
    return { rootStyle, lines };
  },
};
