import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const root = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: tokenVars.radiusLg,
  border: `1px solid ${vars.border}`,
  backgroundColor: vars.surfaceBase,
});

export const header = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: '0.5rem',
  borderBottom: `1px solid ${vars.border}`,
  padding: '0.5rem',
});

export const navigationControls = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: '0.125rem',
});

export const currentFolder = style({
  minWidth: 0,
  flex: '1 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokenVars.textSm,
  color: vars.foreground,
});

export const searchSlot = style({
  marginLeft: 'auto',
  width: 'min(14rem, 45%)',
  flexShrink: 0,
});

export const searchInput = style({
  width: '100%',
});

export const list = style({
  minHeight: '12rem',
});

export const row = style({
  display: 'grid',
  width: '100%',
  gridTemplateColumns: '1rem minmax(0, 1fr) max-content',
  alignItems: 'center',
  gap: '0.625rem',
  border: 0,
  borderBottom: `1px solid ${vars.border}`,
  backgroundColor: 'transparent',
  padding: '0.5625rem 0.75rem',
  color: vars.foreground,
  font: 'inherit',
  textAlign: 'left',
  outline: 'none',
  selectors: {
    '&:not(:disabled)': {
      cursor: 'default',
    },
    '&:not(:disabled):hover': {
      backgroundColor: vars.surfaceHover,
    },
    '&:not(:disabled):focus-visible': {
      boxShadow: `inset 0 0 0 1px ${vars.borderFocus}`,
    },
    '&[data-selected]': {
      backgroundColor: vars.surfaceSelected,
    },
    '&[data-disabled]': {
      color: vars.foregroundPassive,
      opacity: 0.72,
    },
  },
});

export const rowIcon = style({
  width: '1rem',
  height: '1rem',
  color: vars.foregroundMuted,
});

export const rowName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokenVars.textSm,
});

export const rowKind = style({
  flexShrink: 0,
  fontSize: tokenVars.textXs,
  color: vars.foregroundMuted,
});

export const state = style({
  display: 'flex',
  minHeight: '12rem',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '1rem',
  fontSize: tokenVars.textSm,
  color: vars.foregroundMuted,
});

export const stateError = style({
  color: vars.foregroundDestructive,
});

const spin = keyframes({
  to: { transform: 'rotate(360deg)' },
});

export const spinner = style({
  width: '1rem',
  height: '1rem',
  animation: `${spin} 1s linear infinite`,
});

export const footer = style({
  minWidth: 0,
  borderTop: `1px solid ${vars.border}`,
  padding: '0.5rem 0.75rem',
});
