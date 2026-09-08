import { globalStyle } from '@styles/adapter';
import { style } from '@styles/index';

/**
 * Root for opaque icon content. The slot owns geometry and inherited color;
 * its child keeps ownership of markup while the React wrapper hides the
 * decorative subtree from assistive technology.
 */
export const iconSlotAdapter = style({
  alignItems: 'center',
  color: 'currentColor',
  display: 'inline-flex',
  flexShrink: 0,
  justifyContent: 'center',
  lineHeight: 0,
  verticalAlign: 'middle',
});

/**
 * The single shared descendant SVG Adapter. A direct child fills the
 * authoritative slot size even when its source supplies width/height
 * presentation attributes.
 */
globalStyle(`${iconSlotAdapter} > svg`, {
  width: '100%',
  height: '100%',
  display: 'block',
  flexShrink: 0,
  pointerEvents: 'none',
});
