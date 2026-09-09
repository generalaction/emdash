import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const layout = style({
  appearance: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  margin: 0,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
});

export const icon = style({
  pointerEvents: 'none',
  color: tokens.foreground.muted,
});

export const value = style({
  minWidth: 0,
  width: '100%',
  flex: 1,
  overflow: 'hidden',
  color: tokens.foreground.default,
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});

export const placeholder = style({
  color: tokens.foreground.passive,
});

export const chooseAffordance = style({
  pointerEvents: 'none',
});
