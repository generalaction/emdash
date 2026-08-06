import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
// Side-effect import so the @layer order declaration is emitted before these
// rules; otherwise `recipes` gets registered first and loses to app layers.
import '@styles/layers.css';

export const root = style({
  '@layer': {
    recipes: {
      display: 'inline-flex',
      width: 'var(--agent-status-size, 1.5rem)',
      height: 'var(--agent-status-size, 1.5rem)',
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      verticalAlign: 'middle',
      // Sizes the braille spinner glyph relative to the bounding box
      // (~14px at the default 1.5rem box, matching ambient text size).
      fontSize: 'calc(var(--agent-status-size, 1.5rem) * 0.6)',
      lineHeight: 1,
    },
  },
});

export const icon = style({
  '@layer': {
    recipes: {
      display: 'block',
      width: '100%',
      height: '100%',
      overflow: 'visible',
    },
  },
});

export const warningShape = style({
  '@layer': {
    recipes: {
      fill: vars.backgroundWarning,
      stroke: vars.foregroundWarning,
    },
  },
});

export const successShape = style({
  '@layer': {
    recipes: {
      fill: vars.backgroundSuccess,
      stroke: vars.foregroundSuccess,
    },
  },
});

export const errorShape = style({
  '@layer': {
    recipes: {
      fill: vars.backgroundError,
      stroke: vars.foregroundError,
    },
  },
});

export const errorMark = style({
  '@layer': {
    recipes: {
      fill: vars.foregroundError,
      stroke: vars.foregroundError,
      strokeLinecap: 'round',
    },
  },
});
