/**
 * Core metrics — typography, row-level layout, and CSS variable map.
 *
 * Typography constants are the measure/render parity anchor: both pretext
 * measurement and CSS styling read from this single source of truth.
 *
 * Component-private constants (bubble padding, block gap, thinking heights,
 * code block padding) live in each component's metrics.ts.  They are
 * re-imported here only for metricsToCssVars() so CSS variables are complete.
 */

// ── Font families ────────────────────────────────────────────────────────────

export const SANS_FAMILY = '"Inter Variable", sans-serif';
export const MONO_FAMILY = '"Cascadia Code", ui-monospace, monospace';

// ── Per-variant typography ───────────────────────────────────────────────────

export type VariantTypography = {
  fontSize: number;
  fontWeight: number;
  fontStyle?: 'italic';
  lineHeight: number;
};

export const BODY: VariantTypography = { fontSize: 14, fontWeight: 400, lineHeight: 22 };
export const BODY_BOLD: VariantTypography = { fontSize: 14, fontWeight: 700, lineHeight: 22 };
export const BODY_ITALIC: VariantTypography = {
  fontSize: 14,
  fontWeight: 400,
  fontStyle: 'italic',
  lineHeight: 22,
};
export const BODY_BOLD_ITALIC: VariantTypography = {
  fontSize: 14,
  fontWeight: 700,
  fontStyle: 'italic',
  lineHeight: 22,
};
export const BODY_LINK: VariantTypography = { fontSize: 14, fontWeight: 500, lineHeight: 22 };

export const H1: VariantTypography = { fontSize: 20, fontWeight: 700, lineHeight: 28 };
export const H2: VariantTypography = { fontSize: 17, fontWeight: 700, lineHeight: 25 };
export const H3: VariantTypography = { fontSize: 14, fontWeight: 600, lineHeight: 22 };

export const INLINE_CODE: VariantTypography = { fontSize: 12, fontWeight: 600, lineHeight: 22 };
export const MENTION: VariantTypography = { fontSize: 12, fontWeight: 700, lineHeight: 22 };
export const CODE_BLOCK: VariantTypography = { fontSize: 12, fontWeight: 400, lineHeight: 18 };
export const CODE_LANG: VariantTypography = { fontSize: 11, fontWeight: 500, lineHeight: 18 };

// ── Inline chrome ────────────────────────────────────────────────────────────

export const INLINE_CODE_EXTRA_WIDTH = 12;
export const MENTION_EXTRA_WIDTH = 14;

// ── List / blockquote ────────────────────────────────────────────────────────

export const LIST_INDENT = 18;
export const BLOCKQUOTE_INDENT = 18;

// ── Island ───────────────────────────────────────────────────────────────────

export const ISLAND_FIXED_HEIGHT = 300;

// ── User bubble max-width ────────────────────────────────────────────────────

export const USER_BUBBLE_MAX_WIDTH_PCT = 85;

// ── Engine-level row constants ───────────────────────────────────────────────

/** Vertical gap between consecutive virtualised rows. */
export const ROW_GAP = 8;
/** Horizontal padding of each message row from the viewport edge. */
export const ROW_INSET_X = 16;

// ── CSS font shorthands ───────────────────────────────────────────────────────

function fontShorthand(v: VariantTypography, family: string): string {
  const style = v.fontStyle ? `${v.fontStyle} ` : '';
  return `${style}${v.fontWeight} ${v.fontSize}px ${family}`;
}

export const BODY_FONT = fontShorthand(BODY, SANS_FAMILY);
export const BODY_BOLD_FONT = fontShorthand(BODY_BOLD, SANS_FAMILY);
export const BODY_ITALIC_FONT = fontShorthand(BODY_ITALIC, SANS_FAMILY);
export const BODY_BOLD_ITALIC_FONT = fontShorthand(BODY_BOLD_ITALIC, SANS_FAMILY);
export const BODY_LINK_FONT = fontShorthand(BODY_LINK, SANS_FAMILY);
export const H1_FONT = fontShorthand(H1, SANS_FAMILY);
export const H2_FONT = fontShorthand(H2, SANS_FAMILY);
export const H3_FONT = fontShorthand(H3, SANS_FAMILY);
export const INLINE_CODE_FONT = fontShorthand(INLINE_CODE, MONO_FAMILY);
export const MENTION_FONT = fontShorthand(MENTION, SANS_FAMILY);
export const CODE_BLOCK_FONT = fontShorthand(CODE_BLOCK, MONO_FAMILY);

// ── CSS variable map ─────────────────────────────────────────────────────────

/**
 * Produce a flat Record<string, string> of --chat-* CSS custom properties.
 * Set these on the .pchat-transcript root so every var(--chat-*) resolves
 * to the same number used in measurement.
 *
 * Component metrics are imported here and included so the CSS vars are complete.
 */
export function metricsToCssVars(componentVars?: {
  bubblePadX?: number;
  bubblePadY?: number;
  blockGap?: number;
  codeBlockPadY?: number;
  codeBlockPadX?: number;
  codeBlockBorder?: number;
  thinkingHeaderH?: number;
  thinkingWindowH?: number;
  thinkingFadeH?: number;
  thinkingPadY?: number;
}): Record<string, string> {
  const {
    bubblePadX = 14,
    bubblePadY = 10,
    blockGap = 10,
    codeBlockPadY = 10,
    codeBlockPadX = 14,
    codeBlockBorder = 1,
    thinkingHeaderH = 28,
    thinkingWindowH = 72,
    thinkingFadeH = 28,
    thinkingPadY = 8,
  } = componentVars ?? {};

  return {
    '--chat-sans': SANS_FAMILY,
    '--chat-mono': MONO_FAMILY,

    '--chat-body-size': `${BODY.fontSize}px`,
    '--chat-body-weight': `${BODY.fontWeight}`,
    '--chat-body-lh': `${BODY.lineHeight}px`,
    '--chat-body-bold-weight': `${BODY_BOLD.fontWeight}`,
    '--chat-body-link-weight': `${BODY_LINK.fontWeight}`,

    '--chat-h1-size': `${H1.fontSize}px`,
    '--chat-h1-weight': `${H1.fontWeight}`,
    '--chat-h1-lh': `${H1.lineHeight}px`,
    '--chat-h2-size': `${H2.fontSize}px`,
    '--chat-h2-weight': `${H2.fontWeight}`,
    '--chat-h2-lh': `${H2.lineHeight}px`,
    '--chat-h3-size': `${H3.fontSize}px`,
    '--chat-h3-weight': `${H3.fontWeight}`,
    '--chat-h3-lh': `${H3.lineHeight}px`,

    '--chat-ic-size': `${INLINE_CODE.fontSize}px`,
    '--chat-ic-weight': `${INLINE_CODE.fontWeight}`,
    '--chat-ic-pad-x': `6px`,
    '--chat-ic-pad-y': `2px`,

    '--chat-mention-size': `${MENTION.fontSize}px`,
    '--chat-mention-weight': `${MENTION.fontWeight}`,
    '--chat-mention-pad-x': `7px`,

    '--chat-code-size': `${CODE_BLOCK.fontSize}px`,
    '--chat-code-weight': `${CODE_BLOCK.fontWeight}`,
    '--chat-code-lh': `${CODE_BLOCK.lineHeight}px`,
    '--chat-code-pad-y': `${codeBlockPadY}px`,
    '--chat-code-pad-x': `${codeBlockPadX}px`,
    '--chat-code-border': `${codeBlockBorder}px`,

    '--chat-lang-size': `${CODE_LANG.fontSize}px`,
    '--chat-lang-weight': `${CODE_LANG.fontWeight}`,
    '--chat-lang-lh': `${CODE_LANG.lineHeight}px`,

    '--chat-block-gap': `${blockGap}px`,
    '--chat-bubble-pad-y': `${bubblePadY}px`,
    '--chat-bubble-pad-x': `${bubblePadX}px`,
    '--chat-row-gap': `${ROW_GAP}px`,
    '--chat-msg-pad-x': `${ROW_INSET_X}px`,
    '--chat-list-indent': `${LIST_INDENT}px`,
    '--chat-quote-indent': `${BLOCKQUOTE_INDENT}px`,
    '--chat-island-max-h': `${ISLAND_FIXED_HEIGHT}px`,

    '--chat-user-max-w': `${USER_BUBBLE_MAX_WIDTH_PCT}%`,

    '--chat-think-header-h': `${thinkingHeaderH}px`,
    '--chat-think-window-h': `${thinkingWindowH}px`,
    '--chat-think-fade-h': `${thinkingFadeH}px`,
    '--chat-think-pad-y': `${thinkingPadY}px`,
  };
}
