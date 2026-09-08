/**
 * reset.css.ts — mini preflight, assigned to the reset layer.
 *
 * Keeps box-sizing predictable, strips default browser margins/paddings,
 * and opts form controls into the design-system font. Intentionally minimal —
 * no opinionated colour or layout rules belong here.
 */

import { tokens } from '@emdash/theme';
import { createGlobalLayerStyle } from './authoring/layer-rule';
import { layerNames } from './authoring/layers.css';

createGlobalLayerStyle(
  '*, *::before, *::after',
  {
    boxSizing: 'border-box',
  },
  layerNames.reset
);

createGlobalLayerStyle(
  'html, body',
  {
    margin: 0,
    lineHeight: 'inherit',
    fontFamily: tokens.typography.family.sans,
  },
  layerNames.reset
);

// Native form controls do not inherit fonts by default — opt them in so
// inputs, textareas, selects, and buttons use the design-system font.
createGlobalLayerStyle(
  'button, input, optgroup, select, textarea',
  {
    font: 'inherit',
    letterSpacing: 'inherit',
    color: 'inherit',
  },
  layerNames.reset
);

// Strip native button chrome so the User-Agent ButtonFace background does not
// bleed through theme-driven styles (matches Tailwind Preflight). Without this,
// resting buttons that omit a background (e.g. ghost) show a theme-independent
// system gray instead of the surface behind them.
createGlobalLayerStyle(
  'button',
  {
    appearance: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    cursor: 'pointer',
  },
  layerNames.reset
);

// Remove default block margins — matches Tailwind Preflight.
createGlobalLayerStyle(
  'blockquote, dl, dd, h1, h2, h3, h4, h5, h6, hr, figure, p, pre',
  {
    margin: 0,
  },
  layerNames.reset
);

// Headings inherit type styles; size/weight come from utilities or component styles.
createGlobalLayerStyle(
  'h1, h2, h3, h4, h5, h6',
  {
    fontSize: 'inherit',
    fontWeight: 'inherit',
  },
  layerNames.reset
);

// Lists: drop default indentation and margins.
// Does not set list-style: none — left to component/utility intent.
createGlobalLayerStyle(
  'ol, ul',
  {
    margin: 0,
    padding: 0,
  },
  layerNames.reset
);
