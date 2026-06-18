/**
 * Light theme — the default emdash light palette.
 *
 * Tuned to stay visually close to the current Radix-sourced emlight palette:
 *   - Neutral: pure gray (hue 0, very low chroma)
 *   - Accent: jade/teal family (hue ~171)
 *   - Hue scales: green, red, amber, blue, orange, purple
 *   - Background lightness anchored to the current neutral.1 OKLCH L (~0.991)
 */

import { defineTheme } from '../define-theme.js';

export const lightTheme = defineTheme({
  id: 'light',
  label: 'Light',
  polarity: 'light',

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
  background: { lightness: 0.991 },
  gamut: 'p3',

  // Amber sits at a gamut cusp: vivid yellow/amber lives at high L. This is a
  // property of the hue, so the tweak is keyed to the `amber` scale itself.
  // Use dark foreground on the solid step and nudge step lightness slightly.
  tweaks: {
    amber: {
      darkForeground: true,
      steps: {
        9: { l: +0.03 },
        10: { l: +0.02 },
        11: { l: -0.02 },
      },
    },
  },

  syntax: { generate: true },
});
