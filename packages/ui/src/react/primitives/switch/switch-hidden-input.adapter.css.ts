import { globalStyle } from '@styles/adapter';
import { style } from '@styles/index';

/** Rooted Adapter for Base UI's generated form-control input. */
export const switchHiddenInputAdapter = style({});

globalStyle(`${switchHiddenInputAdapter} input[type="checkbox"]`, {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
});
