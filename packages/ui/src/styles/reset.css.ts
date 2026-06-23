/**
 * reset.css.ts — mini preflight, assigned to the reset layer.
 *
 * Keeps box-sizing predictable, strips default browser margins/paddings,
 * and opts form controls into the design-system font. Intentionally minimal —
 * no opinionated colour or layout rules belong here.
 */

import { globalStyle } from '@vanilla-extract/css';
import './layers.css';

globalStyle('*, *::before, *::after', {
  '@layer': {
    reset: {
      boxSizing: 'border-box',
    },
  },
});

globalStyle('html, body', {
  '@layer': {
    reset: {
      margin: 0,
      lineHeight: 'inherit',
      fontFamily: 'var(--font-sans)',
    },
  },
});

// Native form controls do not inherit fonts by default — opt them in so
// inputs, textareas, selects, and buttons use the design-system font.
globalStyle('button, input, optgroup, select, textarea', {
  '@layer': {
    reset: {
      font: 'inherit',
      letterSpacing: 'inherit',
      color: 'inherit',
    },
  },
});
