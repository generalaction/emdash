import { globalStyle } from '@styles/adapter';
import { style } from '@styles/index';

export const generatedDiagramAdapter = style({
  display: 'block',
});

globalStyle(`${generatedDiagramAdapter} > svg`, {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  margin: '0 auto',
});
