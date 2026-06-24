import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type CollapsibleCardStyleVars = {
  height: number;
};

export const collapsibleCardVars = createVariableThemeContract<CollapsibleCardStyleVars>({
  height: null,
});

// ── Card shell ────────────────────────────────────────────────────────────────

export const collapsibleCard = style({
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radiusLg,
  overflow: 'hidden',
  boxSizing: 'border-box',
  height: collapsibleCardVars.height,
});

// ── Header row ────────────────────────────────────────────────────────────────
//
// Uses content-box (default) intentionally: the borderBottom adds 1px that is
// counted in chromeY() = 3 * border (top shell border + header separator +
// bottom shell border). Changing box-sizing here would shift the measured height.

export const cardHeader = style({
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
  transition: 'background 150ms',
  userSelect: 'none',
  selectors: {
    '&:hover': { background: vars.bg3 },
  },
});

// ── Chevron ───────────────────────────────────────────────────────────────────

export const cardChevron = style({
  display: 'inline-block',
  fontSize: '10px',
  transition: 'transform 150ms ease-out',
  flexShrink: 0,
});

export const cardChevronExpanded = style({
  transform: 'rotate(90deg)',
});
