import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const treeViewport = style({
  height: '100%',
  padding: '0.5rem 0.25rem',
});

export const row = style({
  position: 'relative',
  display: 'flex',
  width: '100%',
  height: '28px',
  alignItems: 'center',
  gap: '0.5rem',
  border: 0,
  borderRadius: '6px',
  backgroundColor: 'transparent',
  padding: '0 8px 0 var(--file-tree-row-indent, 4px)',
  color: vars.foreground,
  font: 'inherit',
  outline: 'none',
  textAlign: 'left',
  userSelect: 'none',
  selectors: {
    '&:not(:disabled)': {
      cursor: 'default',
    },
    '&:not(:disabled):hover': {
      backgroundColor: vars.background1,
    },
    '&:not(:disabled):focus-visible': {
      boxShadow: `inset 0 0 0 1px ${vars.borderFocus}`,
    },
    '&[data-opened]': {
      backgroundColor: vars.background1,
    },
    '&[data-opened]:hover': {
      backgroundColor: vars.background1,
    },
    '&[data-selected]': {
      backgroundColor: vars.background2,
    },
    '&[data-selected]:hover': {
      backgroundColor: vars.background2,
    },
    '&[data-drop-target]': {
      backgroundColor: vars.selection,
      color: vars.selectionForeground,
    },
    '&[data-pending]': {
      opacity: 0.62,
    },
  },
});

export const chevron = style({
  display: 'inline-flex',
  width: '14px',
  height: '14px',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  color: vars.foregroundMuted,
});

export const label = style({
  display: 'flex',
  minWidth: 0,
  flex: '1 1 auto',
  alignItems: 'baseline',
  gap: '0.375rem',
});

export const name = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  selectors: {
    '&[data-tone="success"]': {
      color: vars.foregroundSuccess,
    },
    '&[data-tone="warning"]': {
      color: vars.foregroundWarning,
    },
    '&[data-tone="error"]': {
      color: vars.foregroundError,
    },
    '&[data-tone="info"]': {
      color: vars.foregroundDiffModified,
    },
  },
});

export const secondary = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokenVars.textXs,
  color: vars.foregroundMuted,
});

export const state = style({
  display: 'flex',
  minHeight: '10rem',
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
