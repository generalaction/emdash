import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const band = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
  borderRadius: `${tokenVars.radiusXl} ${tokenVars.radiusXl} 0 0`,
  border: `1px solid ${vars.border}`,
  borderBottomWidth: 0,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
  backgroundColor: vars.surface,
  color: vars.foreground,
  fontSize: tokenVars.textXs,
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
  paddingLeft: '0.25rem',
  paddingRight: '0.25rem',
  color: vars.foregroundMuted,
  lineHeight: 1.375,
});

export const headerIcon = style({
  width: '0.875rem',
  height: '0.875rem',
  flexShrink: 0,
});

export const headerStrong = style({
  fontWeight: 500,
  color: vars.foreground,
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
});

export const row = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '0.5rem',
  minHeight: '1.875rem',
  borderRadius: tokenVars.radiusMd,
  paddingLeft: '0.25rem',
  paddingRight: '0.25rem',
  selectors: {
    '&:hover': { backgroundColor: vars.surfaceHover },
    '&:focus-within': { backgroundColor: vars.surfaceHover },
  },
});

export const index = style({
  width: '1.25rem',
  color: vars.foregroundMuted,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
});

export const promptText = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: 1.375,
});

export const emptyText = style({
  color: vars.foregroundMuted,
  fontStyle: 'italic',
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.125rem',
  opacity: 0.72,
  transition: 'opacity 150ms',
  selectors: {
    [`${row}:hover &`]: { opacity: 1 },
    [`${row}:focus-within &`]: { opacity: 1 },
  },
});

export const editArea = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
  minWidth: 0,
});

export const editInput = style({
  flex: 1,
  minWidth: 0,
  resize: 'vertical',
  maxHeight: '7rem',
  border: `1px solid ${vars.border}`,
  borderRadius: tokenVars.radiusMd,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  backgroundColor: vars.surfaceBaseEmphasis,
  color: vars.foreground,
  font: 'inherit',
  lineHeight: 1.375,
  outline: 'none',
  selectors: {
    '&:focus': {
      borderColor: vars.border1,
      boxShadow: `0 0 0 1px ${vars.border1}`,
    },
  },
});
