import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';
import { kfPopupIn } from '../theme/animations.css';

export const popupRoot = style({
  zIndex: 50,
  minWidth: '220px',
  maxWidth: '340px',
  overflow: 'hidden',
  borderRadius: 'var(--radius-md)',
  backgroundColor: vars.surface,
  color: vars.foreground,
  boxShadow: `0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
  animation: `${kfPopupIn} 100ms both`,
});

export const popupHeader = style({
  borderBottom: `1px solid ${vars.border}`,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-xs)',
  color: vars.foregroundMuted,
});

export const popupList = style({
  maxHeight: '240px',
  scrollPaddingTop: '0.25rem',
  scrollPaddingBottom: '0.25rem',
  overflowY: 'auto',
  padding: '0.25rem',
});

export const popupItem = style({
  position: 'relative',
  display: 'flex',
  width: '100%',
  cursor: 'default',
  userSelect: 'none',
  alignItems: 'center',
  gap: '0.5rem',
  borderRadius: 'var(--radius-sm)',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  paddingLeft: '0.5rem',
  paddingRight: '2rem',
  fontSize: 'var(--text-sm)',
  outline: 'none',
});

export const popupItemDefault = style({
  color: vars.foreground,
});

export const popupItemHighlighted = style({
  backgroundColor: vars.surfaceHover,
  color: vars.foreground,
});

export const popupItemHover = style({
  color: vars.foreground,
  selectors: {
    '&:hover': { backgroundColor: vars.surfaceHover },
  },
});

export const popupItemIcon = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  fontSize: '1em',
});
globalStyle(`${popupItemIcon} svg`, { width: '1rem', height: '1rem' });

export const popupItemLabel = style({
  flex: '1 1 0%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const popupItemDescription = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 'var(--text-xs)',
  color: vars.foregroundMuted,
});

export const popupDismiss = style({
  display: 'inline-flex',
  width: '1rem',
  height: '1rem',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  opacity: 0.5,
  selectors: {
    '&:hover': { opacity: 1 },
  },
});
