/**
 * Core metrics — typography, row-level layout, and font shorthand builders.
 *
 * Typography constants are derived from @emdash/ui design tokens (tokens.js) so
 * that pretext measurement and CSS styling share a single source of truth.
 *
 * Component-private constants (bubble padding, block gap, thinking heights,
 * code block padding) live in each component's metrics.ts.
 *
 * The full CSS variable map is assembled by chatCssVars() in css-vars.ts.
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
