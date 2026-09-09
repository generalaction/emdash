import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const root = style({
  display: 'flex',
  width: '100%',
  minWidth: 0,
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: tokens.space.step2,
});

export const search = style({
  width: '100%',
  minWidth: 0,
  maxWidth: '24rem',
  flex: '1 1 14rem',
});

export const group = style({
  display: 'flex',
  minWidth: 0,
  maxWidth: '100%',
  flex: '0 1 auto',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: tokens.space.step2,
});

export const spacer = style({
  minWidth: 0,
  flex: '1 1 0',
});

export const separator = style({
  display: 'flex',
  height: '1.25rem',
  alignSelf: 'center',
  alignItems: 'stretch',
});
