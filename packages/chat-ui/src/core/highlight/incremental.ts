/**
 * incremental — budget-bounded tokenization via @shikijs/stream.
 *
 * The synchronous whole-block path (computeHighlightRaw) stalls frames for
 * 100ms+ on large code blocks. ShikiStreamTokenizer tokenizes per line while
 * carrying TextMate grammar state across enqueues, which lets us slice the
 * work: tokenize lines until a time budget is spent, yield back to the
 * caller's idle scheduler, and resume. No single slice exceeds ~budgetMs of
 * synchronous work, so highlighting never blocks a frame.
 *
 * Produces byte-identical output to computeHighlightRaw (verified by tests):
 * colors only, zero layout risk.
 */

import { ShikiStreamTokenizer } from '@shikijs/stream';
import type { HighlighterCore, ThemedToken } from 'shiki/core';
import type { CodeToken, HighlightResult, IncrementalHighlightOpts } from './highlighter';

const DEFAULT_BUDGET_MS = 6;

function toCodeTokens(tokens: ThemedToken[]): CodeToken[] {
  return tokens.map((tok) => {
    const token: CodeToken = { content: tok.content };
    if (tok.htmlStyle && Object.keys(tok.htmlStyle).length > 0) {
      token.htmlStyle = tok.htmlStyle as Record<string, string>;
    }
    return token;
  });
}

/**
 * Tokenize `code` for `resolvedLang` in idle-bounded slices. Resolves to the
 * same HighlightResult as computeHighlightRaw, or null when cancelled.
 */
export async function tokenizeIncremental(
  hl: HighlighterCore,
  code: string,
  resolvedLang: string,
  opts: IncrementalHighlightOpts
): Promise<HighlightResult | null> {
  const { yieldToIdle, budgetMs = DEFAULT_BUDGET_MS, isCancelled = () => false } = opts;
  const tokenizer = new ShikiStreamTokenizer({
    highlighter: hl,
    lang: resolvedLang,
    themes: { light: 'em-light', dark: 'em-dark' },
    defaultColor: false,
  });

  const srcLines = code.split('\n');
  const last = srcLines.length - 1;
  const lines: CodeToken[][] = [];
  let sliceStart = performance.now();

  for (let i = 0; i < srcLines.length; i++) {
    if (performance.now() - sliceStart >= budgetMs) {
      await yieldToIdle();
      if (isCancelled()) return null;
      sliceStart = performance.now();
    }
    if (i < last) {
      // Feeding "line\n" settles exactly this line: enqueue returns its
      // stable tokens plus a trailing "\n" marker token we drop.
      const { stable } = await tokenizer.enqueue(srcLines[i] + '\n');
      lines.push(toCodeTokens(stable.slice(0, -1)));
    } else {
      // Final line has no newline terminator; close() flushes it as stable.
      await tokenizer.enqueue(srcLines[i]);
      const { stable } = tokenizer.close();
      lines.push(toCodeTokens(stable));
    }
  }

  const bg = hl.codeToTokens('', {
    lang: resolvedLang,
    themes: { light: 'em-light', dark: 'em-dark' },
    defaultColor: false,
  }).bg;
  return { rootStyle: typeof bg === 'string' ? bg : '', lines };
}
