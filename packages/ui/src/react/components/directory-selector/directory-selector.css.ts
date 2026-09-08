import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';
import { kfRotateTo } from '@styles/effects/animations.css';

const columns = '1rem minmax(0, 1fr) 5rem 7rem 7.5rem';

export const root = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: tokens.radius.lg,
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: tokens.surface.level.base.background,
});

export const header = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: '0.5rem',
  borderBottom: `1px solid ${tokens.border.default}`,
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
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
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

export const columnHeader = style({
  display: 'grid',
  gridTemplateColumns: columns,
  alignItems: 'center',
  gap: '0.625rem',
  borderBottom: `1px solid ${tokens.border.default}`,
  padding: '0.375rem 0.75rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const row = style({
  display: 'grid',
  width: '100%',
  gridTemplateColumns: columns,
  alignItems: 'center',
  gap: '0.625rem',
  border: 0,
  borderBottom: `1px solid ${tokens.border.default}`,
  backgroundColor: 'transparent',
  padding: '0.5625rem 0.75rem',
  color: tokens.foreground.default,
  font: 'inherit',
  textAlign: 'left',
  outline: 'none',
  selectors: {
    '&:not(:disabled)': {
      cursor: 'default',
    },
    '&:not(:disabled):hover': {
      backgroundColor: tokens.surface.current.hover,
    },
    '&:not(:disabled):focus-visible': {
      boxShadow: `inset 0 0 0 1px ${tokens.border.focus}`,
    },
    '&[data-selected]': {
      backgroundColor: tokens.surface.current.selected,
    },
    '&[data-disabled]': {
      color: tokens.foreground.passive,
      opacity: 0.72,
    },
  },
});

export const draftRow = style({
  display: 'grid',
  width: '100%',
  gridTemplateColumns: columns,
  alignItems: 'center',
  gap: '0.625rem',
  borderBottom: `1px solid ${tokens.border.default}`,
  padding: '0.5625rem 0.75rem',
  backgroundColor: tokens.surface.current.selected,
});

export const draftInput = style({
  minWidth: 0,
  width: '100%',
  border: 0,
  background: 'transparent',
  padding: 0,
  color: tokens.foreground.default,
  font: 'inherit',
  fontSize: tokens.typography.size.sm,
  outline: 'none',
  selectors: {
    '&::placeholder': {
      color: tokens.foreground.passive,
    },
  },
});

export const rowIcon = style({
  color: tokens.foreground.muted,
  vars: {
    [iconSizeVar]: '1rem',
  },
});

export const rowName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokens.typography.size.sm,
});

export const rowMeta = style({
  flexShrink: 0,
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
  fontVariantNumeric: 'tabular-nums',
});

export const rowMetaEnd = style({
  textAlign: 'right',
});

export const state = style({
  display: 'flex',
  minHeight: '12rem',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '1rem',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
});

export const stateError = style({
  color: tokens.palette.red.step11,
});

export const spinner = style({
  animation: `${kfRotateTo} 1s linear infinite`,
  vars: {
    [iconSizeVar]: '1rem',
  },
});

export const footer = style({
  minWidth: 0,
  borderTop: `1px solid ${tokens.border.default}`,
  padding: '0.5rem 0.75rem',
});

export const footerActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginTop: '0.5rem',
});

export const footerActionsRight = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginLeft: 'auto',
});
