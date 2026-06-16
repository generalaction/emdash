/**
 * Core metrics — typography, row-level layout, and CSS variable map.
 *
 * Typography constants are derived from @emdash/ui design tokens (tokens.js) so
 * that pretext measurement and CSS styling share a single source of truth.
 * The metricsToCssVars() output wraps each value in a var(--typography-*) reference
 * with the token value as a fallback, so the design system resolves when the theme
 * is loaded while standalone Storybook keeps working without any extra CSS imports.
 *
 * Component-private constants (bubble padding, block gap, thinking heights,
 * code block padding) live in each component's metrics.ts.  They are
 * re-imported here only for metricsToCssVars() so CSS variables are complete.
 */

import { tokens } from '@emdash/ui/theme/tokens.js';

// ── Token helpers ─────────────────────────────────────────────────────────────

type DimToken = { value: number; unit: string };

const dim = (id: keyof typeof tokens): number => (tokens[id]['.'] as unknown as DimToken).value;
const num = (id: keyof typeof tokens): number => tokens[id]['.'] as unknown as number;
const family = (id: keyof typeof tokens): string =>
  (tokens[id]['.'] as unknown as string[]).join(', ');

// ── Font families ────────────────────────────────────────────────────────────

export const SANS_FAMILY = family('typography.font-family.sans');
export const MONO_FAMILY = family('typography.font-family.mono');

// ── Per-variant typography ───────────────────────────────────────────────────

export type VariantTypography = {
  fontSize: number;
  fontWeight: number;
  fontStyle?: 'italic';
  lineHeight: number;
};

export const BODY: VariantTypography = {
  fontSize: dim('typography.body.size'),
  fontWeight: num('typography.body.weight'),
  lineHeight: dim('typography.body.line-height'),
};
export const BODY_BOLD: VariantTypography = {
  fontSize: dim('typography.body.size'),
  fontWeight: num('typography.body.bold-weight'),
  lineHeight: dim('typography.body.line-height'),
};
export const BODY_ITALIC: VariantTypography = {
  fontSize: dim('typography.body.size'),
  fontWeight: num('typography.body.weight'),
  fontStyle: 'italic',
  lineHeight: dim('typography.body.line-height'),
};
export const BODY_BOLD_ITALIC: VariantTypography = {
  fontSize: dim('typography.body.size'),
  fontWeight: num('typography.body.bold-weight'),
  fontStyle: 'italic',
  lineHeight: dim('typography.body.line-height'),
};
export const BODY_LINK: VariantTypography = {
  fontSize: dim('typography.body.size'),
  fontWeight: num('typography.body.link-weight'),
  lineHeight: dim('typography.body.line-height'),
};

export const H1: VariantTypography = {
  fontSize: dim('typography.h1.size'),
  fontWeight: num('typography.h1.weight'),
  lineHeight: dim('typography.h1.line-height'),
};
export const H2: VariantTypography = {
  fontSize: dim('typography.h2.size'),
  fontWeight: num('typography.h2.weight'),
  lineHeight: dim('typography.h2.line-height'),
};
export const H3: VariantTypography = {
  fontSize: dim('typography.h3.size'),
  fontWeight: num('typography.h3.weight'),
  lineHeight: dim('typography.h3.line-height'),
};

export const INLINE_CODE: VariantTypography = {
  fontSize: dim('typography.inline-code.size'),
  fontWeight: num('typography.inline-code.weight'),
  lineHeight: dim('typography.inline-code.line-height'),
};
export const MENTION: VariantTypography = {
  fontSize: dim('typography.mention.size'),
  fontWeight: num('typography.mention.weight'),
  lineHeight: dim('typography.mention.line-height'),
};
export const CODE_BLOCK: VariantTypography = {
  fontSize: dim('typography.code.size'),
  fontWeight: num('typography.code.weight'),
  lineHeight: dim('typography.code.line-height'),
};
export const CODE_LANG: VariantTypography = {
  fontSize: dim('typography.code-lang.size'),
  fontWeight: num('typography.code-lang.weight'),
  lineHeight: dim('typography.code-lang.line-height'),
};

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

function fontShorthand(v: VariantTypography, fam: string): string {
  const style = v.fontStyle ? `${v.fontStyle} ` : '';
  return `${style}${v.fontWeight} ${v.fontSize}px ${fam}`;
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
 * Each typography value is emitted as var(--typography-*, <fallback>) so the
 * design system token resolves when theme.css is loaded, while standalone
 * Storybook (without the theme import) still works via the fallback.
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
    '--chat-sans': `var(--typography-font-family-sans, ${SANS_FAMILY})`,
    '--chat-mono': `var(--typography-font-family-mono, ${MONO_FAMILY})`,

    '--chat-body-size': `var(--typography-body-size, ${BODY.fontSize}px)`,
    '--chat-body-weight': `var(--typography-body-weight, ${BODY.fontWeight})`,
    '--chat-body-lh': `var(--typography-body-line-height, ${BODY.lineHeight}px)`,
    '--chat-body-bold-weight': `var(--typography-body-bold-weight, ${BODY_BOLD.fontWeight})`,
    '--chat-body-link-weight': `var(--typography-body-link-weight, ${BODY_LINK.fontWeight})`,

    '--chat-h1-size': `var(--typography-h1-size, ${H1.fontSize}px)`,
    '--chat-h1-weight': `var(--typography-h1-weight, ${H1.fontWeight})`,
    '--chat-h1-lh': `var(--typography-h1-line-height, ${H1.lineHeight}px)`,
    '--chat-h2-size': `var(--typography-h2-size, ${H2.fontSize}px)`,
    '--chat-h2-weight': `var(--typography-h2-weight, ${H2.fontWeight})`,
    '--chat-h2-lh': `var(--typography-h2-line-height, ${H2.lineHeight}px)`,
    '--chat-h3-size': `var(--typography-h3-size, ${H3.fontSize}px)`,
    '--chat-h3-weight': `var(--typography-h3-weight, ${H3.fontWeight})`,
    '--chat-h3-lh': `var(--typography-h3-line-height, ${H3.lineHeight}px)`,

    '--chat-ic-size': `var(--typography-inline-code-size, ${INLINE_CODE.fontSize}px)`,
    '--chat-ic-weight': `var(--typography-inline-code-weight, ${INLINE_CODE.fontWeight})`,
    '--chat-ic-pad-x': `6px`,
    '--chat-ic-pad-y': `2px`,

    '--chat-mention-size': `var(--typography-mention-size, ${MENTION.fontSize}px)`,
    '--chat-mention-weight': `var(--typography-mention-weight, ${MENTION.fontWeight})`,
    '--chat-mention-pad-x': `7px`,

    '--chat-code-size': `var(--typography-code-size, ${CODE_BLOCK.fontSize}px)`,
    '--chat-code-weight': `var(--typography-code-weight, ${CODE_BLOCK.fontWeight})`,
    '--chat-code-lh': `var(--typography-code-line-height, ${CODE_BLOCK.lineHeight}px)`,
    '--chat-code-pad-y': `${codeBlockPadY}px`,
    '--chat-code-pad-x': `${codeBlockPadX}px`,
    '--chat-code-border': `${codeBlockBorder}px`,

    '--chat-lang-size': `var(--typography-code-lang-size, ${CODE_LANG.fontSize}px)`,
    '--chat-lang-weight': `var(--typography-code-lang-weight, ${CODE_LANG.fontWeight})`,
    '--chat-lang-lh': `var(--typography-code-lang-line-height, ${CODE_LANG.lineHeight}px)`,

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
