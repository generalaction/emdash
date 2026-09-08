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
  minWidth: '12rem',
  flex: '1 1 16rem',
});

export const trailing = style({
  display: 'flex',
  minWidth: 0,
  flex: '0 1 auto',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: tokens.space.step2,
  marginLeft: 'auto',
});

export const metadata = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: tokens.space.step2,
});

export const actions = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: tokens.space.step2,
});
