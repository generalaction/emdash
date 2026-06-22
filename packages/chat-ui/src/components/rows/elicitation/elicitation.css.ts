import { style } from '@vanilla-extract/css';
import { sx } from '@styles/sprinkles.css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ElicitationStyleVars = { rowH: number };

export const elicitationVars = createVariableThemeContract<ElicitationStyleVars>({ rowH: null });

// ── Outer container ───────────────────────────────────────────────────────────

export const elicitationRoot = style({
  height: elicitationVars.rowH,
});

export const elicitationBox = sx({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '3',
  borderWidth: '1',
  borderStyle: 'solid',
  borderColor: 'border',
  borderRadius: 'md',
  paddingLeft: '3',
  paddingRight: '2',
  height: 'full',
  overflow: 'hidden',
});

export const elicitationLabel = sx({
  display: 'flex',
  alignItems: 'center',
  gap: '1.5',
  color: 'fgPassive',
  flex: '1',
  overflow: 'hidden',
});

export const elicitationTitle = style({
  fontSize: '0.875rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ── Split button ──────────────────────────────────────────────────────────────

export const splitButton = sx({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  userSelect: 'none',
});

export const splitButtonPrimary = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  paddingLeft: '10px',
  paddingRight: '10px',
  height: '28px',
  fontSize: '0.8125rem',
  fontWeight: 500,
  borderRadius: `${vars.radiusMd} 0 0 ${vars.radiusMd}`,
  border: `1px solid ${vars.border}`,
  borderRight: 'none',
  background: vars.bg1,
  color: vars.fg,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      background: vars.bg2,
    },
    '&:disabled': {
      opacity: 0.5,
      cursor: 'default',
    },
  },
});

export const splitButtonChevron = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '24px',
  height: '28px',
  fontSize: '0.75rem',
  borderRadius: `0 ${vars.radiusMd} ${vars.radiusMd} 0`,
  border: `1px solid ${vars.border}`,
  background: vars.bg1,
  color: vars.fgMuted,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: vars.bg2,
    },
    '&:disabled': {
      opacity: 0.5,
      cursor: 'default',
    },
  },
});

// ── Portal menu ───────────────────────────────────────────────────────────────

export const menuPortal = style({
  position: 'fixed',
  zIndex: 1000,
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radiusMd,
  background: vars.bg,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  padding: '4px',
  minWidth: '140px',
});

export const menuItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  width: '100%',
  padding: '6px 10px',
  fontSize: '0.8125rem',
  borderRadius: vars.radiusSm,
  border: 'none',
  background: 'transparent',
  color: vars.fg,
  cursor: 'pointer',
  textAlign: 'left',
  selectors: {
    '&:hover': {
      background: vars.bg1,
    },
  },
});

export const menuItemSelected = style({
  background: vars.bg2,
});

export const menuItemDot = style({
  width: '6px',
  height: '6px',
  borderRadius: '9999px',
  flexShrink: 0,
});

export const dotAccept = style({ background: vars.diffAdded });
export const dotReject = style({ background: vars.diffDeleted });
export const dotNeutral = style({ background: vars.fgPassive });
