import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';
import { kfRotateTo } from '@styles/effects/animations.css';

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
  padding: '0 8px 0 var(--_file-tree-row-indent, 4px)',
  color: tokens.foreground.default,
  font: 'inherit',
  outline: 'none',
  textAlign: 'left',
  userSelect: 'none',
  selectors: {
    '&:not(:disabled)': {
      cursor: 'default',
    },
    '&:not(:disabled):hover': {
      backgroundColor: tokens.palette.neutral.step2,
    },
    '&:not(:disabled):focus-visible': {
      boxShadow: `inset 0 0 0 1px ${tokens.border.focus}`,
    },
    '&[data-opened]': {
      backgroundColor: tokens.palette.neutral.step2,
    },
    '&[data-opened]:hover': {
      backgroundColor: tokens.palette.neutral.step2,
    },
    '&[data-selected]': {
      backgroundColor: tokens.palette.neutral.step3,
    },
    '&[data-selected]:hover': {
      backgroundColor: tokens.palette.neutral.step3,
    },
    '&[data-drop-target]': {
      backgroundColor: tokens.selection.background,
      color: tokens.selection.foreground,
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
  color: tokens.foreground.muted,
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
      color: tokens.feedback.success.foreground,
    },
    '&[data-tone="warning"]': {
      color: tokens.feedback.warning.foreground,
    },
    '&[data-tone="error"]': {
      color: tokens.feedback.error.foreground,
    },
    '&[data-tone="info"]': {
      color: tokens.palette.amber.step9,
    },
  },
});

export const secondary = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const state = style({
  display: 'flex',
  minHeight: '10rem',
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

export const root = style({
  display: 'flex',
  // The virtualized viewport can only scroll when the component is height-bounded,
  // so it fills whatever container the consumer provides instead of growing to content.
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: tokens.surface.level.base.background,
  color: tokens.foreground.default,
});

export const header = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: '0.5rem',
  borderBottom: `1px solid ${tokens.border.default}`,
  padding: '0.5rem',
});

export const headerTarget = style({
  minWidth: 0,
  flex: '1 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const headerActions = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: '0.25rem',
});

export const toolbar = style({
  display: 'flex',
  height: '41px',
  flexShrink: 0,
  alignItems: 'center',
  gap: '0.25rem',
  borderBottom: `1px solid ${tokens.border.default}`,
  padding: '0 0.5rem',
  backgroundColor: tokens.surface.level.base.background,
});

export const toolbarSearch = style({
  minWidth: 0,
  flex: '1 1 auto',
});

export const toolbarActions = style({
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

export const rowWrapper = style({
  height: '100%',
});

export const indentGuide = style({
  position: 'absolute',
  top: '-1px',
  width: '1px',
  height: 'calc(100% + 2px)',
  backgroundColor: tokens.border.subtle,
  opacity: 0,
  pointerEvents: 'none',
  transition: 'opacity 100ms ease',
  selectors: {
    [`${root}:hover &`]: {
      opacity: 1,
    },
  },
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
  color: tokens.foreground.muted,
});

export const decoration = style({
  display: 'flex',
  minWidth: 0,
  flexShrink: 0,
  alignItems: 'center',
  gap: '0.375rem',
});

export const muted = style({
  color: tokens.foreground.muted,
});

export const strikethrough = style({
  textDecoration: 'line-through',
});

export const draftRow = style({
  backgroundColor: tokens.palette.neutral.step3,
});

export const draftInput = style({
  minWidth: 0,
  width: '100%',
  border: 0,
  background: 'transparent',
  padding: 0,
  color: tokens.foreground.default,
  font: 'inherit',
  fontSize: '13px',
  outline: 'none',
  selectors: {
    '&::placeholder': {
      color: tokens.foreground.passive,
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
  backgroundColor: tokens.selection.background,
  pointerEvents: 'none',
});
