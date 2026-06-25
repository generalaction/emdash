/**
 * base.css.ts — global element defaults, assigned to the base layer.
 *
 * Applies design-system colour tokens to body, scrollbars, and selection.
 * Intentionally avoids app-specific layout rules (height/overflow on html/body,
 * #root constraints, xterm/Monaco/diff integrations) — those belong in the
 * consuming app's own stylesheet.
 */

import { globalStyle } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import './layers.css';

// Border colour — picked up by every element's default border.
globalStyle('*', {
  '@layer': {
    base: {
      borderColor: vars.border,
    },
  },
});

// Body defaults.
globalStyle('body', {
  '@layer': {
    base: {
      backgroundColor: vars.background,
      color: vars.foreground,
    },
  },
});

// Selection.
globalStyle('::selection', {
  '@layer': {
    base: {
      backgroundColor: `color-mix(in srgb, ${vars.selection} 35%, transparent)`,
      color: vars.selectionForeground,
    },
  },
});

globalStyle('::-moz-selection', {
  '@layer': {
    base: {
      backgroundColor: `color-mix(in srgb, ${vars.selection} 35%, transparent)`,
      color: vars.selectionForeground,
    },
  },
});

// Scrollbar styles for light and dark mode.
globalStyle('*', {
  '@layer': {
    base: {
      scrollbarWidth: 'thin',
      scrollbarColor: `${vars.border} transparent`,
    },
  },
});

globalStyle('*::-webkit-scrollbar', {
  '@layer': {
    base: {
      width: '8px',
      height: '8px',
    },
  },
});

globalStyle('*::-webkit-scrollbar-track', {
  '@layer': {
    base: {
      background: 'transparent',
    },
  },
});

globalStyle('*::-webkit-scrollbar-thumb', {
  '@layer': {
    base: {
      backgroundColor: vars.border,
      borderRadius: '4px',
      border: '2px solid transparent',
      backgroundClip: 'content-box',
    },
  },
});
