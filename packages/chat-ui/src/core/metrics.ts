/**
 * Core metrics — typography, row-level layout, and font shorthand builders.
 *
 * Typography constants are derived from @emdash/ui composite type.* design tokens
 * (tokens.js) so that pretext measurement and CSS styling share a single source of
 * truth. Each role is read from the composite token object; the flat typography.*
 * primitive tokens remain in tokens.js as aliases but are no longer read directly here.
 *
 * Component-private constants (bubble padding, block gap, thinking heights,
 * code block padding) live inline in each component's `.def.tsx` file.
 * The only standalone component metrics file is `components/file-op/file-op-metrics.ts`.
 *
 * CSS variables are applied inline in `ChatRoot.tsx` `onMount`; there is no
 * separate css-vars.ts module.
 */

import { tokens } from '@emdash/ui/theme/tokens.js';

// ── Composite role reader ─────────────────────────────────────────────────────

type CompositeRole = {
  fontFamily: string[];
  fontSize: { value: number; unit: string };
  fontWeight: number;
  lineHeight: { value: number; unit: string };
  fontStyle?: string;
};

function role(id: keyof typeof tokens): CompositeRole {
  return tokens[id]['.'] as unknown as CompositeRole;
}

// ── Font families ────────────────────────────────────────────────────────────

const _bodySans = role('type.body');
const _codeMono = role('type.code');

export const SANS_FAMILY = _bodySans.fontFamily.join(', ');
export const MONO_FAMILY = _codeMono.fontFamily.join(', ');

// ── Per-variant typography ───────────────────────────────────────────────────

export type VariantTypography = {
  fontSize: number;
  fontWeight: number;
  fontStyle?: 'italic';
  lineHeight: number;
};

function toVariant(r: CompositeRole): VariantTypography {
  return {
    fontSize: r.fontSize.value,
    fontWeight: r.fontWeight,
    lineHeight: r.lineHeight.value,
    ...(r.fontStyle === 'italic' ? { fontStyle: 'italic' as const } : {}),
  };
}

export const BODY: VariantTypography = toVariant(role('type.body'));
export const BODY_BOLD: VariantTypography = toVariant(role('type.body-bold'));
export const BODY_ITALIC: VariantTypography = toVariant(role('type.body-italic'));
export const BODY_BOLD_ITALIC: VariantTypography = {
  ...toVariant(role('type.body-bold')),
  fontStyle: 'italic',
};
export const BODY_LINK: VariantTypography = toVariant(role('type.body-link'));

export const H1: VariantTypography = toVariant(role('type.h1'));
export const H2: VariantTypography = toVariant(role('type.h2'));
export const H3: VariantTypography = toVariant(role('type.h3'));

export const INLINE_CODE: VariantTypography = toVariant(role('type.inline-code'));
export const MENTION: VariantTypography = toVariant(role('type.mention'));
export const CODE_BLOCK: VariantTypography = toVariant(role('type.code'));
export const CODE_LANG: VariantTypography = toVariant(role('type.code-lang'));

// ── Inline chrome ────────────────────────────────────────────────────────────

export const INLINE_CODE_EXTRA_WIDTH = 12;
export const MENTION_EXTRA_WIDTH = 14;

// ── List / blockquote ────────────────────────────────────────────────────────

export const LIST_INDENT = 16;
export const BLOCKQUOTE_INDENT = 18;

/** Horizontal gap from the bullet's center anchor to the start of list text. */
export const LIST_BULLET_GAP = 12;

// ── User bubble max-width ────────────────────────────────────────────────────

export const USER_BUBBLE_MAX_WIDTH_PCT = 85;

// ── Collapsible row header ────────────────────────────────────────────────────

/**
 * Extra vertical space (px) added to the body line-height to produce the
 * standard single-line collapsible header row height.
 *
 * header height = theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H
 *
 * Used by thinkingDef and fileOpDef so they share the same constant.
 */
export const HEADER_ROW_EXTRA_H = 8;

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
