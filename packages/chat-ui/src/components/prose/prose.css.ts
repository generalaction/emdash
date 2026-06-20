/**
 * prose.css.ts — geometry-coupled styles for Prose.tsx.
 *
 * Rules in this file feed pretext width/height measurement and MUST produce
 * identical computed values to what the old prose.module.css emitted.
 * Run the prose contract tests after any edit here.
 *
 * Visual decoration (colors, backgrounds, cursors) lives in the component via
 * sprinkles / inline vars — nothing visual belongs here.
 */

import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';

// ── Lines ─────────────────────────────────────────────────────────────────────

/** A pre-laid-out line row. Height is set via inline style from the line-height constant. */
export const pline = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'baseline',
});

// ── Fragments — base ──────────────────────────────────────────────────────────

/**
 * white-space: pre   — prevents browser re-wrapping
 * line-height: 1     — keeps vertical alignment controlled entirely by geometry
 * absolute centering — top:50% + translateY(-50%) centers within the line band
 * These rules feed pretext and must NOT be changed to utility classes.
 */
export const pf = style({
  display: 'inline-block',
  whiteSpace: 'pre',
  lineHeight: 1,
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
});

// ── Fragment variants ─────────────────────────────────────────────────────────

export const pfBody = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyFontWeight,
  fontFamily: vars.typeBodyFontFamily,
});

export const pfBold = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyBoldFontWeight,
  fontFamily: vars.typeBodyFontFamily,
});

export const pfItalic = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyFontWeight,
  fontStyle: 'italic',
  fontFamily: vars.typeBodyFontFamily,
});

export const pfBoldItalic = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyBoldFontWeight,
  fontStyle: 'italic',
  fontFamily: vars.typeBodyFontFamily,
});

export const pfLink = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyLinkFontWeight,
  fontFamily: vars.typeBodyFontFamily,
  // color, text-decoration, cursor — applied in Prose.tsx via sprinkles
});

export const pfH1 = style({
  fontSize: vars.typeH1FontSize,
  fontWeight: vars.typeH1FontWeight,
  fontFamily: vars.typeH1FontFamily,
});

export const pfH2 = style({
  fontSize: vars.typeH2FontSize,
  fontWeight: vars.typeH2FontWeight,
  fontFamily: vars.typeH2FontFamily,
});

/** h3–h6 share the h3 scale. */
export const pfH3 = style({
  fontSize: vars.typeH3FontSize,
  fontWeight: vars.typeH3FontWeight,
  fontFamily: vars.typeH3FontFamily,
});

/** Inline code chip — font metrics and padding feed pretext measurement. */
export const pfInlineCode = style({
  fontSize: vars.typeInlineCodeFontSize,
  fontWeight: vars.typeInlineCodeFontWeight,
  fontFamily: vars.typeInlineCodeFontFamily,
  paddingTop: vars.icPadY,
  paddingBottom: vars.icPadY,
  paddingLeft: vars.icPadX,
  paddingRight: vars.icPadX,
});

/**
 * Mention chip — font metrics and padding feed pretext measurement.
 *
 * font-size (12px) / font-weight (500) / padding (2px 4px) are hardcoded
 * literals matching core/tokens.ts CHIP_DEFAULTS so the rendered chip is
 * byte-identical to what the old prose.module.css produced.
 * font-family follows the body font (same as MENTION_FONT in metrics.ts).
 */
export const pfMention = style({
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: vars.typeBodyFontFamily,
  paddingTop: '2px',
  paddingBottom: '2px',
  paddingLeft: '4px',
  paddingRight: '4px',
});

// ── Lookup map for dynamic variant resolution ─────────────────────────────────

/**
 * Prose.tsx resolves fragment class names dynamically via fragKey().
 * This map replaces the old `styles['pf--body']` CSS-module pattern.
 */
export const pfVariants: Record<string, string> = {
  'pf--body': pfBody,
  'pf--bold': pfBold,
  'pf--italic': pfItalic,
  'pf--bold-italic': pfBoldItalic,
  'pf--link': pfLink,
  'pf--h1': pfH1,
  'pf--h2': pfH2,
  'pf--h3': pfH3,
  'pf--h4': pfH3,
  'pf--h5': pfH3,
  'pf--h6': pfH3,
  'pf--inline-code': pfInlineCode,
  'pf--mention': pfMention,
};

// ── Decorations ───────────────────────────────────────────────────────────────

export const pbullet = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transform: 'translate(-50%, -50%)',
  fontSize: vars.typeBodyFontSize,
  fontFamily: vars.typeBodyFontFamily,
  lineHeight: 1,
  // color — applied via sprinkles in Prose.tsx
});

export const pquoteRail = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: '3px',
  // background and borderRadius — applied in Prose.tsx
});
