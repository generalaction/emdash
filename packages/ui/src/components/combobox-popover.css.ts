import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';

export const trigger = style({
  display: 'flex',
  height: '1.75rem',
  minWidth: 0,
  alignItems: 'center',
  gap: '0.375rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid transparent',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  fontSize: 'var(--text-xs)',
  color: vars.foreground,
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: vars.surfaceHover },
    '&[data-popup-open]': { backgroundColor: vars.surfaceHover },
  },
});

export const triggerLabel = style({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
});

export const triggerChevron = style({
  flexShrink: 0,
  color: vars.foregroundMuted,
});
