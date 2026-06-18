/**
 * Dark theme — the default emdash dark palette.
 *
 * Tuned to stay visually close to the current Radix-sourced emdark palette:
 *   - Neutral: near-black background (OKLCH L ~0.178), very low chroma
 *   - Accent: jade/teal family (same hue as light; different L curve)
 *   - Hue scales: green, red, amber, blue, orange, purple (dark polarity)
 *   - Background anchored at neutral.1 dark OKLCH L (~0.178)
 */

import { defineTheme } from '../define-theme.js';

export const darkTheme = defineTheme({
  id: 'dark',
  label: 'Dark',
  polarity: 'dark',

  accent: { hue: 171, chroma: 0.17 },
  neutral: { hue: 0, chroma: 0.002 },

  hues: {
    green: 147,
    red: 23,
    amber: 81,
    blue: 252,
    orange: 55,
    purple: 305,
  },

  contrast: 'normal',
  chroma: 1.0,
  background: { lightness: 0.178 },
  gamut: 'p3',

  tweaks: {
    amber: {
      darkForeground: true,
      steps: {
        9: { l: +0.05 },
        10: { l: +0.04 },
        11: { l: -0.01 },
      },
    },
  },

  syntax: { generate: true },
});
