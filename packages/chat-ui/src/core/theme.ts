/**
 * ChatTheme — single injection interface for all external measurement inputs.
 *
 * Replaces the scattered `FontConfig` import and component-level `metrics.ts`
 * files. One `ChatTheme` object carries both typography (fonts) and geometry
 * (all px constants that were previously spread across components/<comp>/metrics.ts
 * and core/metrics.ts). Callers that previously passed FontConfig now pass a
 * `ChatTheme`; default values are assembled by `buildTheme()`.
 *
 * Geometry constants that depend on typography (e.g. `toolRowH = lineHeight`)
 * are computed from `fonts` inside `buildTheme()` so the whole theme is
 * self-consistent. Pure geometry constants are literal defaults here.
 *
 * `version` is bumped (by the caller) whenever any value changes so the
 * identity-based node memo in the registry can detect theme invalidation.
 */

import type { FontConfig } from './measure/fonts';
import { DEFAULT_FONT_CONFIG } from './measure/fonts';

// ── Geometry scale ────────────────────────────────────────────────────────────

export type GeometryScale = {
  // ── Row / message ───────────────────────────────────────────────────────────
  rowInsetX: number;
  listIndent: number;
  listBulletGap: number;
  blockquoteIndent: number;
  islandFixedH: number;
  userBubbleMaxWidthPct: number;

  // ── Message bubble ──────────────────────────────────────────────────────────
  bubblePadX: number;
  bubblePadY: number;
  blockGap: number;
  proseGap: number;
  messageFooterH: number;

  // ── Code block ──────────────────────────────────────────────────────────────
  codePadX: number;
  codePadY: number;
  codeBorder: number;

  // ── Table ───────────────────────────────────────────────────────────────────
  tableRowH: number;
  tableBorder: number;
  tableMinColW: number;

  // ── Tool / Execute / Diff rows (font-derived) ───────────────────────────────
  toolRowH: number;
  execRowH: number;
  diffHeaderH: number;
  diffMaxLines: number;
  diffContext: number;
  diffBorder: number;
  diffFadeH: number;

  // ── Thinking ─────────────────────────────────────────────────────────────────
  thinkingHeaderH: number;
  thinkingWindowH: number;
  thinkingFadeH: number;
  thinkingPadY: number;

  // ── File-op ──────────────────────────────────────────────────────────────────
  fileopRowH: number;
  fileopLineH: number;
  fileopWindowH: number;
  fileopFadeH: number;
  fileopPadY: number;

  // ── Inline code chrome (shared by Prose + Execute chip) ──────────────────────
  inlineCodePadX: number;
  inlineCodePadY: number;

  // ── Row-level symmetric wrapper padding per kind ────────────────────────────
  rowPadY: Readonly<Record<string, number>>;
};

// ── ChatTheme ─────────────────────────────────────────────────────────────────

export type ChatTheme = {
  /**
   * Monotonically-increasing integer. Bump this (by cloning with a new version)
   * whenever geometry or fonts change so the node memo fingerprint detects the
   * invalidation without a deep equality check.
   */
  version: number;
  fonts: FontConfig;
  geometry: GeometryScale;
};

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Assemble a self-consistent ChatTheme from a FontConfig.
 *
 * Font-derived constants (toolRowH, tableRowH, thinkingHeaderH, fileopRowH/LineH)
 * are computed from `fonts.body.lineHeight` / `fonts.code.lineHeight` so they
 * stay in sync with the font metrics. Pure geometry constants have literal
 * defaults that match the historical per-component metrics.ts values.
 */
export function buildTheme(fonts: FontConfig = DEFAULT_FONT_CONFIG): ChatTheme {
  const bodyLH = fonts.body.lineHeight;

  const geometry: GeometryScale = {
    // Row / message
    rowInsetX: 16,
    listIndent: 16,
    listBulletGap: 12,
    blockquoteIndent: 18,
    islandFixedH: 300,
    userBubbleMaxWidthPct: 85,

    // Message bubble
    bubblePadX: 14,
    bubblePadY: 8,
    blockGap: 10,
    proseGap: 4,
    messageFooterH: 24,

    // Code block
    codePadX: 8,
    codePadY: 8,
    codeBorder: 1,

    // Table (font-derived row height: body lineHeight + 12px vertical padding)
    tableRowH: bodyLH + 12,
    tableBorder: 1,
    tableMinColW: 80,

    // Tool / execute row (font-derived)
    toolRowH: bodyLH,
    execRowH: 28,

    // Diff
    diffHeaderH: 28,
    diffMaxLines: 12,
    diffContext: 1,
    diffBorder: 1,
    diffFadeH: 24,

    // Thinking (font-derived header: body lineHeight + 4px top + 4px bottom)
    thinkingHeaderH: bodyLH + 8,
    thinkingWindowH: 72,
    thinkingFadeH: 28,
    thinkingPadY: 8,

    // File-op (font-derived)
    fileopRowH: bodyLH + 8,
    fileopLineH: bodyLH,
    fileopWindowH: 72,
    fileopFadeH: 24,
    fileopPadY: 6,

    // Inline code chrome
    inlineCodePadX: 6,
    inlineCodePadY: 2,

    // Per-kind row wrapper padding (mirrors historical ROW_PAD_Y in core/metrics.ts)
    rowPadY: {
      message: 4,
      thinking: 0,
      tool: 0,
      'file-op': 0,
      execute: 0,
      diff: 0,
    },
  };

  return { version: 1, fonts, geometry };
}

export const DEFAULT_THEME: ChatTheme = buildTheme();
