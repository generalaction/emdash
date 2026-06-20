/**
 * diff.css.ts — geometry-coupled and Shiki color styles for Diff.tsx.
 *
 * Preserves byte-identical computed values with the old diff.module.css.
 * Run the diff contract tests after any edit here.
 */

import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';

// ── Body container ────────────────────────────────────────────────────────────

export const pdiffBody = style({
  position: 'relative',
});

// ── Diff lines ────────────────────────────────────────────────────────────────

export const pdiffLine = style({
  whiteSpace: 'pre',
  fontSize: vars.typeCodeFontSize,
  fontWeight: vars.typeCodeFontWeight,
  fontFamily: vars.typeCodeFontFamily,
  // line-height is set via inline style in Diff.tsx (from theme.fonts.code.lineHeight)
  // so it cannot drift from the measured value via a CSS variable.
});

// ── Shiki token color wiring ──────────────────────────────────────────────────
// Light-theme Shiki tokens use --shiki-light; dark tokens use --shiki-dark.
// globalStyle with the ancestor class selector mirrors the old
//   `.pdiff__line span { color: var(--shiki-light) }`
//   `:global(.emdark) .pdiff__line span { color: var(--shiki-dark) }`

globalStyle(`${pdiffLine} span`, {
  color: 'var(--shiki-light)',
});

globalStyle(`.emdark ${pdiffLine} span`, {
  color: 'var(--shiki-dark)',
});
