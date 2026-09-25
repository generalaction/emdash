/**
 * estimate-text — width-aware markdown height heuristics for `estimate()` hooks.
 *
 * Mirrors the real block-stack model (parse → per-block measure → margin-collapse
 * stacking) with a cheap line scan instead of a parse: fenced code counts at code
 * line height plus box chrome, headings/lists/quotes get their prose variants'
 * line heights and margins, and paragraphs wrap at a chars-per-line derived from
 * the actual column width and body font size.
 *
 * Calibrated against the rendering-audit harness (scenario e): real prose at
 * 880px/14px wraps at ~97–105 chars per line, i.e. an average glyph advance of
 * ~0.62em including spaces and end-of-line wrap waste.
 *
 * Exactness is not the goal — near-viewport rows are corrected to exact heights
 * by prefetch before they enter the window; estimates only shape scrollbar
 * proportion for far-off rows.
 */

import type { ChatTheme } from '@core/theme';

/** Average glyph advance as a fraction of the body font size (incl. wrap waste). */
const AVG_CHAR_EM = 0.62;

/** Mirrors CODE_BLOCK_PAD_Y / CODE_BLOCK_BORDER in rows/markdown/code/layout.ts. */
const CODE_CHROME = 2 * 8 + 2 * 1;

/** Approximate horizontal space consumed by list/quote markers and indent. */
const LIST_INDENT_PX = 24;
const QUOTE_INDENT_PX = 16;

/** Prose margins per variant — mirrors prose.def.tsx margin(). */
const PARA_MARGIN = { top: 6, bottom: 6 };
const LIST_MARGIN = { top: 2, bottom: 2 };
const CODE_MARGIN = { top: 8, bottom: 8 };
const RULE_MARGIN = { top: 12, bottom: 12 };
const HEADING_MARGIN: Record<1 | 2 | 3, { top: number; bottom: number }> = {
  1: { top: 16, bottom: 6 },
  2: { top: 13, bottom: 5 },
  3: { top: 10, bottom: 4 },
};

/** Chars per wrapped line for body prose at the given column width. */
export function estimateCharsPerLine(width: number, theme: ChatTheme): number {
  const size = theme.config.roles.body.size;
  return Math.max(16, Math.floor(width / (size * AVG_CHAR_EM)));
}

type Blk = { height: number; top: number; bottom: number };

const FENCE_RE = /^(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^(?:[-*+]|\d+[.)])\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/**
 * Estimate the rendered height (px) of a markdown/plain text body laid out at
 * `width`. Returns at least one body line height, matching the empty-content
 * fallback in measureMessage.
 */
export function estimateMarkdownHeight(text: string, width: number, theme: ChatTheme): number {
  const roles = theme.config.roles;
  const bodyLH = roles.body.lineHeight;
  const codeLH = roles.code.lineHeight;
  const cpl = estimateCharsPerLine(width, theme);
  const wrapLines = (len: number, effectiveCpl: number): number =>
    Math.max(1, Math.ceil(len / Math.max(1, effectiveCpl)));

  const blocks: Blk[] = [];
  let paraLen = 0;
  let inFence = false;
  let fenceLines = 0;

  const flushPara = (): void => {
    if (paraLen === 0) return;
    blocks.push({ height: wrapLines(paraLen, cpl) * bodyLH, ...PARA_MARGIN });
    paraLen = 0;
  };
  const flushFence = (): void => {
    blocks.push({ height: Math.max(1, fenceLines) * codeLH + CODE_CHROME, ...CODE_MARGIN });
    inFence = false;
    fenceLines = 0;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trimStart();

    if (FENCE_RE.test(trimmed)) {
      if (inFence) flushFence();
      else {
        flushPara();
        inFence = true;
        fenceLines = 0;
      }
      continue;
    }
    if (inFence) {
      fenceLines++;
      continue;
    }
    if (trimmed === '') {
      flushPara();
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flushPara();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      const role = roles[`h${level}` as 'h1' | 'h2' | 'h3'];
      const headingCpl = Math.max(16, Math.floor(width / (role.size * AVG_CHAR_EM)));
      blocks.push({
        height: wrapLines(heading[2].length, headingCpl) * role.lineHeight,
        ...HEADING_MARGIN[level],
      });
      continue;
    }

    if (RULE_RE.test(trimmed)) {
      flushPara();
      blocks.push({ height: 1, ...RULE_MARGIN });
      continue;
    }

    const list = LIST_RE.exec(trimmed);
    if (list) {
      flushPara();
      const effCpl = estimateCharsPerLine(Math.max(1, width - LIST_INDENT_PX), theme);
      blocks.push({ height: wrapLines(list[1].length, effCpl) * bodyLH, ...LIST_MARGIN });
      continue;
    }

    const quote = QUOTE_RE.exec(trimmed);
    if (quote) {
      flushPara();
      const effCpl = estimateCharsPerLine(Math.max(1, width - QUOTE_INDENT_PX), theme);
      blocks.push({ height: wrapLines(quote[1].length, effCpl) * bodyLH, ...PARA_MARGIN });
      continue;
    }

    // Plain text: accumulate into the current paragraph (+1 for the joining space).
    paraLen += (paraLen > 0 ? 1 : 0) + trimmed.length;
  }

  if (inFence) flushFence(); // streaming: unclosed fence renders as code
  flushPara();

  if (blocks.length === 0) return bodyLH;

  let total = 0;
  for (let i = 0; i < blocks.length; i++) {
    total += blocks[i].height;
    if (i > 0) total += Math.max(blocks[i - 1].bottom, blocks[i].top);
  }
  return total;
}
