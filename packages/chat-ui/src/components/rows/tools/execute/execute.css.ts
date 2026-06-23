import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { textShimmer } from '@styles/effects.css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ExecuteStyleVars = {
  height: number;
  headerH: number;
};

export const executeVars = createVariableThemeContract<ExecuteStyleVars>({
  height: null,
  headerH: null,
});

// ── Card shell ────────────────────────────────────────────────────────────────

export const executeCard = style({
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radiusLg,
  overflow: 'hidden',
  boxSizing: 'border-box',
  height: executeVars.height,
});

// ── Header ────────────────────────────────────────────────────────────────────

export const executeHeader = style({
  height: executeVars.headerH,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '6px',
  paddingLeft: '8px',
  paddingRight: '8px',
  cursor: 'pointer',
  color: vars.fgMuted,
  fontSize: '0.875rem',
  borderBottom: `1px solid ${vars.border}`,
  userSelect: 'none',
  transition: 'background 150ms',
  selectors: {
    '&:hover': { background: vars.bg3 },
  },
});

export const executeChevron = recipe({
  base: {
    display: 'inline-block',
    fontSize: '10px',
    transition: 'transform 150ms ease-out',
    flexShrink: 0,
  },
  variants: {
    expanded: {
      true: { transform: 'rotate(90deg)' },
      false: {},
    },
  },
});

// ── Body ──────────────────────────────────────────────────────────────────────

/** Wrapper: height + overflow set inline (depend on expanded state + bodyH). */
export const executeBody = style({
  position: 'relative',
});

// ── Line ──────────────────────────────────────────────────────────────────────

export const executeLine = style({
  whiteSpace: 'pre',
  fontSize: vars.typeCodeFontSize,
  fontWeight: vars.typeCodeFontWeight,
  fontFamily: vars.typeCodeFontFamily,
  color: vars.fg,
  paddingLeft: '12px',
  paddingRight: '12px',
  // line-height is set via inline style from theme.fonts.code.lineHeight
  // so it cannot drift from the measured value via a CSS variable.
});

globalStyle(`${executeLine} span`, {
  color: 'var(--shiki-light)',
});

globalStyle(`.emdark ${executeLine} span`, {
  color: 'var(--shiki-dark)',
});

export { textShimmer };
