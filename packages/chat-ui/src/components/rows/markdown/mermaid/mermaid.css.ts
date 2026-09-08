/**
 * mermaid.css.ts — styles for the Mermaid diagram preview block.
 *
 * Fixed 21:9 aspect-ratio clickable container: card border, overflow hidden,
 * transparent background so the SVG CSS variables resolve against the chat
 * theme, and a hover affordance for the click-to-view affordance.
 */

import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';

/** Outer container — absolute inset-0 within the BlockFrame. */
export const mermaidWrapper = style({
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  borderRadius: vars.radiusLg,
  border: `1px solid ${vars.border}`,
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ':hover': {
    borderColor: vars.fgMuted,
  },
});

/** Placeholder shown before the idle SVG render completes. */
export const mermaidPlaceholder = style({
  fontFamily: vars.fontSans,
  fontSize: '12px',
  color: vars.fgPassive,
  userSelect: 'none',
  pointerEvents: 'none',
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

/** Fallback label when the diagram source is invalid. */
export const mermaidError = style({
  fontFamily: vars.fontSans,
  fontSize: '12px',
  color: vars.fgError,
  userSelect: 'none',
  pointerEvents: 'none',
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});
