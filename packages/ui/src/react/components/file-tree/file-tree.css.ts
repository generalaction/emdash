import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const root = style({
  display: 'flex',
  // The virtualized viewport can only scroll when the component is height-bounded,
  // so it fills whatever container the consumer provides instead of growing to content.
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: vars.surfaceBase,
  color: vars.foreground,
});

export const header = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: '0.5rem',
  borderBottom: `1px solid ${vars.border}`,
  padding: '0.5rem',
});

export const headerTarget = style({
  minWidth: 0,
  flex: '1 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokenVars.textXs,
  color: vars.foregroundMuted,
});

export const headerActions = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: '0.25rem',
});

export const body = style({
  position: 'relative',
  minHeight: 0,
  flex: '1 1 auto',
});

export const treeViewport = style({
  height: '100%',
  padding: '0.5rem 0.25rem',
});

export const rowWrapper = style({
  height: '100%',
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

export const indentGuide = style({
  position: 'absolute',
  top: '-1px',
  width: '1px',
  height: 'calc(100% + 2px)',
  backgroundColor: vars.borderSubtle,
  opacity: 0,
  pointerEvents: 'none',
  transition: 'opacity 100ms ease',
  selectors: {
    [`${root}:hover &`]: {
      opacity: 1,
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

export const spacer = style({
  width: '14px',
  height: '14px',
  flexShrink: 0,
});

export const icon = style({
  display: 'inline-flex',
  width: '14px',
  height: '14px',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  color: vars.foregroundMuted,
});

export const fileIcon = style({
  width: '12px',
  height: '12px',
});

export const devicon = style({
  display: 'inline-block',
  width: '12px',
  height: '12px',
  flexShrink: 0,
  fontSize: '12px',
  lineHeight: '12px',
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
});

export const secondary = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokenVars.textXs,
  color: vars.foregroundMuted,
});

export const decoration = style({
  display: 'flex',
  minWidth: 0,
  flexShrink: 0,
  alignItems: 'center',
  gap: '0.375rem',
});

export const muted = style({
  color: vars.foregroundMuted,
});

export const strikethrough = style({
  textDecoration: 'line-through',
});

export const draftRow = style({
  backgroundColor: vars.background2,
});

export const draftInput = style({
  minWidth: 0,
  width: '100%',
  border: 0,
  background: 'transparent',
  padding: 0,
  color: vars.foreground,
  font: 'inherit',
  fontSize: '13px',
  outline: 'none',
  selectors: {
    '&::placeholder': {
      color: vars.foregroundPassive,
    },
  },
});

export const rootDropTarget = style({
  position: 'absolute',
  right: '0.5rem',
  bottom: '0.5rem',
  left: '0.5rem',
  height: '2px',
  borderRadius: '999px',
  backgroundColor: vars.selection,
  pointerEvents: 'none',
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
