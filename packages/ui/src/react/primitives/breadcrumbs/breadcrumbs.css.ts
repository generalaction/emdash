import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

export const root = style({
  minWidth: 0,
});

export const list = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const item = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
});

export const separator = style({
  marginInline: '0.375rem',
  flexShrink: 0,
  color: tokens.foreground.passive,
  vars: {
    [iconSizeVar]: '0.75rem',
  },
});

export const label = style({
  overflow: 'hidden',
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.sm,
  lineHeight: 1.25,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const current = style([
  label,
  {
    color: tokens.foreground.default,
  },
]);

export const link = style({
  overflow: 'hidden',
  border: 0,
  borderRadius: tokens.radius.sm,
  padding: 0,
  background: 'transparent',
  color: tokens.foreground.muted,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: tokens.typography.size.sm,
  lineHeight: 1.25,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      color: tokens.foreground.default,
    },
    '&:focus-visible': {
      outline: `2px solid ${tokens.border.focus}`,
      outlineOffset: '2px',
    },
  },
});
