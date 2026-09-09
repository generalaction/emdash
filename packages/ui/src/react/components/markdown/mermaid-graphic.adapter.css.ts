import { globalStyle } from '@styles/adapter';
import { style } from '@styles/index';

export const mermaidPreviewGraphicAdapter = style({
  display: 'block',
});

globalStyle(`${mermaidPreviewGraphicAdapter} > svg`, {
  display: 'block',
  height: 'auto',
  maxWidth: '100%',
});

export const mermaidDialogGraphicAdapter = style({
  display: 'block',
});

globalStyle(`${mermaidDialogGraphicAdapter} > svg`, {
  display: 'block',
  height: 'auto',
  maxWidth: 'none',
});
