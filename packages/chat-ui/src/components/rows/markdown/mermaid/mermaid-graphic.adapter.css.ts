import { globalStyle, style } from '@vanilla-extract/css';

/** Rooted adapter for Mermaid's generated SVG markup. */
export const mermaidGraphicAdapter = style({
  width: '100%',
  height: '100%',
});

globalStyle(`${mermaidGraphicAdapter} > svg`, {
  display: 'block',
  width: '100%',
  height: '100%',
});
