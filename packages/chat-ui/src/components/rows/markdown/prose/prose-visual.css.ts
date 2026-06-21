/**
 * prose-visual.css.ts — visual decoration for Prose.tsx fragments.
 *
 * These classes complement the geometry classes in prose.css.ts.
 * They do NOT affect measurement — only color/bg/decoration/cursor.
 */

import { style } from '@vanilla-extract/css';
import { vars } from '../../../../styles/theme.css';

// ── Inline code chip ──────────────────────────────────────────────────────────

export const inlineCodeChip = style({
  borderRadius: '4px',
  background: vars.codeInlineBg,
});

// ── Mention chip — resolved context mention (neutral chip) ────────────────────

export const mentionChip = style({
  borderRadius: vars.radiusSm,
  background: vars.mentionChipBg,
  color: vars.mentionChipFg,
  // 1px ring via box-shadow (Tailwind's ring-1 equivalent)
  boxShadow: `0 0 0 1px ${vars.mentionChipRing}`,
});

// ── Mention chip — plain/math mention (blue tint) ────────────────────────────

export const mentionPlain = style({
  borderRadius: vars.radiusFull,
  background: vars.mentionBg,
  color: vars.mentionFg,
});

// ── Link fragment ─────────────────────────────────────────────────────────────

export const linkFragment = style({
  color: vars.link,
  textDecoration: 'underline',
  textDecorationThickness: '1px',
  textUnderlineOffset: '0.14em',
  cursor: 'pointer',
});

// ── Bullet / quote rail ───────────────────────────────────────────────────────

export const bulletColor = style({ color: vars.fgMuted });

export const quoteRailBar = style({
  background: vars.border,
  borderRadius: vars.radiusFull,
});

// ── Visual class map for fragVisualClass ──────────────────────────────────────

export const fragVisual = {
  inlineCode: inlineCodeChip,
  mentionChip,
  mentionPlain,
  link: linkFragment,
} as const;
