import { style } from '@styles/index';

export const scrollContainer = style({
  minHeight: 0,
  flex: '1 1 0%',
  overflowX: 'hidden',
  overflowY: 'auto',
});

export const spacer = style({
  position: 'relative',
});

export const virtualRow = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
});
