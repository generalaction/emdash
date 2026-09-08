import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const root = style({
  display: 'flex',
});

export const separatorH = style({
  flexShrink: 0,
  width: '100%',
  height: '1px',
  backgroundColor: tokens.border.subtle,
});

export const separatorV = style({
  flexShrink: 0,
  alignSelf: 'stretch',
  width: '1px',
  height: 'auto',
  backgroundColor: tokens.border.subtle,
});
