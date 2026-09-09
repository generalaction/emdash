import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const root = style({
  display: 'flex',
  width: '100%',
  minWidth: 0,
  alignItems: 'center',
  gap: '0.75rem',
});

export const icon = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
});

export const title = style({
  display: 'flex',
  minWidth: 0,
  flex: '1 1 auto',
  alignItems: 'center',
  overflow: 'hidden',
});

export const actions = style({
  display: 'flex',
  minWidth: 0,
  flexShrink: 0,
  alignItems: 'center',
  gap: '0.5rem',
  marginLeft: 'auto',
});

export const editableTitleInput = style({
  appearance: 'none',
  width: '100%',
  minWidth: 0,
  height: '2rem',
  border: 0,
  backgroundColor: 'transparent',
  color: tokens.foreground.default,
  padding: 0,
  font: 'inherit',
  fontSize: tokens.typography.size.sm,
  outline: 'none',
});
