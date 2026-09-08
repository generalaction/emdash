import { style } from '@vanilla-extract/css';
import { shikiTokensAdapter } from '@styles/shiki-tokens.adapter.css';
import { vars } from '@styles/theme.css';

// ── Body ──────────────────────────────────────────────────────────────────────

/** Wrapper: height + overflow set inline (depend on expanded state + bodyH). */
export const executeBody = style({
  position: 'relative',
  boxSizing: 'content-box',
  scrollbarWidth: 'thin',
  selectors: {
    '&::-webkit-scrollbar': {
      width: 'var(--execute-scrollbar-size)',
      height: 'var(--execute-scrollbar-size)',
    },
  },
});

// ── Line ──────────────────────────────────────────────────────────────────────

export const executeLine = style([
  shikiTokensAdapter,
  {
    whiteSpace: 'pre',
    fontSize: vars.typeCodeFontSize,
    fontWeight: vars.typeCodeFontWeight,
    fontFamily: vars.typeCodeFontFamily,
    color: vars.fg,
    // line-height is set via inline style from theme.fonts.code.lineHeight
    // so it cannot drift from the measured value via a CSS variable.
  },
]);

export const executeOutputLine = style({
  color: vars.fgMuted,
});

export const executeSpacerLine = style({
  userSelect: 'none',
});

export const executeTruncatedLine = style({
  color: vars.fgPassive,
  fontStyle: 'italic',
  userSelect: 'none',
});
