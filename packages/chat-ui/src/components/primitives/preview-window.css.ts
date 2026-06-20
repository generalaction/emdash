import { style } from '@vanilla-extract/css';

export const overlayTop = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  zIndex: 10,
});

export const overlayBottom = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 10,
});
