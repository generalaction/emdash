/**
 * Core metrics — typography constants and font shorthand builders.
 *
 * Typography constants are derived from the bundled composite type.* design tokens
 * in core/measure/default-typography.ts so that pretext measurement and CSS styling
 * share a single source of truth.
 *
 * Row rhythm (rowGap, rowH, rowInsetX, headerRowExtraH) and density (blockGap,
 * proseGap) live on ChatTheme.density (core/theme.ts) — the canonical source.
 *
 * Component-private constants (bubble padding, block gap, thinking heights,
 * code block padding, file-op geometry) live inline in each component's def file.
 */

import { DEFAULT_TYPOGRAPHY, type CompositeRole } from './measure/default-typography';
import {
  CHIP_DEFAULTS,
  INLINE_CODE_EXTRA_WIDTH as _IC_EXTRA_WIDTH,
  MENTION_EXTRA_WIDTH as _M_EXTRA_WIDTH,
  MONO_FAMILY_CSS,
  SANS_FAMILY_CSS,
} from './tokens';

// ── Composite role reader ─────────────────────────────────────────────────────

function role(id: string): CompositeRole {
  const r = DEFAULT_TYPOGRAPHY[id];
  if (!r) throw new Error(`metrics: unknown type role "${id}"`);
  return r;
}

// ── Font families ────────────────────────────────────────────────────────────

export const SANS_FAMILY = SANS_FAMILY_CSS;
export const MONO_FAMILY = MONO_FAMILY_CSS;

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

export const INLINE_CODE_EXTRA_WIDTH = _IC_EXTRA_WIDTH;

// Mention chip geometry — used by BOTH the measurement pass (to-rich-items.ts)
// and the renderer (Prose.tsx) so they can never drift.
export const MENTION_PAD_X = CHIP_DEFAULTS.mentionPadX;
export const MENTION_PAD_Y = CHIP_DEFAULTS.mentionPadY;
export const MENTION_ICON_W = CHIP_DEFAULTS.mentionIconW;
export const MENTION_ICON_GAP = CHIP_DEFAULTS.mentionIconGap;
export const MENTION_EXTRA_WIDTH = _M_EXTRA_WIDTH;

// ── List / blockquote ────────────────────────────────────────────────────────

export const LIST_INDENT = 16;
export const BLOCKQUOTE_INDENT = 18;

/** Horizontal gap from the bullet's center anchor to the start of list text. */
export const LIST_BULLET_GAP = 12;

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
