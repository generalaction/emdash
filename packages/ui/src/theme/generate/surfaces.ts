/**
 * generate/surfaces.ts
 *
 * Generates the surface elevation scale + hover/selected state layers.
 *
 * Surfaces are sampled from the neutral OKLCH curve at fractional positions,
 * rather than picking discrete ramp steps. This gives intermediate values
 * between steps so we never need more than 12 ramp steps.
 *
 * State layers (hover / selected) are elevation-independent fixed OKLCH ΔL
 * shifts from each surface base. Light surfaces darken on interaction;
 * dark surfaces lighten. This mirrors the existing build-state-layers.mjs
 * logic, now integrated into the TypeScript pipeline.
 */

import Color from 'colorjs.io';
import { ELEVATION_POSITIONS, STATE_LAYER_DELTA } from '../contract/targets.js';
import type { Polarity, Ramp, Surfaces, SurfaceLevel } from '../contract/roles.js';

// ── Internal constants ────────────────────────────────────────────────────────

const P3_FORMAT_PRECISION = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toP3String(c: Color): string {
  const p3 = c.to('p3');
  const [r, g, b] = p3.coords.map((v) =>
    Math.max(0, Math.min(1, +Number(v).toFixed(P3_FORMAT_PRECISION))),
  );
  return `color(display-p3 ${r} ${g} ${b})`;
}

function shiftOklabL(c: Color, delta: number): Color {
  const oklab = c.to('oklab');
  const newL = Math.max(0, Math.min(1, oklab.coords[0] + delta));
  oklab.coords[0] = newL;
  return oklab.to('p3') as Color;
}

/**
 * Interpolate a point on the neutral ramp's OKLCH lightness curve.
 * pos=0 corresponds to step 1 (the lightest/darkest end, near-background).
 * pos=1 corresponds to step 12 (the darkest/lightest end, text range).
 *
 * For light mode: step 1 is bright (L≈0.97), step 12 is dark (L≈0.12).
 * For dark mode:  step 1 is dark  (L≈0.07), step 12 is bright (L≈0.95).
 *
 * Interpolation is linear in L (perceptually reasonable for achromatic surfaces).
 */
function interpolateNeutralL(neutralRamp: Ramp, pos: number): number {
  // Extract OKLCH L from each end step
  const step1Color = new Color(neutralRamp.steps[0]);
  const step12Color = new Color(neutralRamp.steps[11]);
  const L1 = step1Color.to('oklch').coords[0];
  const L12 = step12Color.to('oklch').coords[0];
  return L1 + (L12 - L1) * pos;
}

/**
 * Build one SurfaceLevel: derive base, hover, and selected colors.
 * The base is sampled from the neutral curve at `pos`.
 * Hover/selected are OKLab L shifts applied to the base.
 */
function buildSurfaceLevel(neutralRamp: Ramp, pos: number, polarity: Polarity): SurfaceLevel {
  // Derive base OKLCH by interpolating L and using minimal chroma (gray surfaces)
  const L = interpolateNeutralL(neutralRamp, pos);
  // Use step 1 hue as the surface hue (maintains warm/cool tint of neutral)
  const step1 = new Color(neutralRamp.steps[0]).to('oklch');
  const hue = step1.coords[2];
  const chroma = Math.max(0, step1.coords[1] * 0.8); // slightly less chroma than step 1

  const baseOklch = new Color('oklch', [L, chroma, hue || 0]);
  // Clamp to P3
  const baseP3 = baseOklch.inGamut('p3')
    ? baseOklch.to('p3')
    : (baseOklch.toGamut({ space: 'p3' }) as Color).to('p3');

  // Direction: light surfaces darken on interaction, dark surfaces lighten
  const dir = polarity === 'dark' ? 1 : -1;

  const hoverColor = shiftOklabL(baseP3, dir * STATE_LAYER_DELTA.hover);
  const selectedColor = shiftOklabL(baseP3, dir * STATE_LAYER_DELTA.selected);

  return {
    base: toP3String(baseP3),
    hover: toP3String(hoverColor),
    selected: toP3String(selectedColor),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate the full surface elevation set from the resolved neutral ramp.
 *
 * Each elevation samples the neutral L-curve at a fractional position so
 * surfaces are perceptually distinct without requiring extra discrete steps.
 */
export function generateSurfaces(neutralRamp: Ramp, polarity: Polarity): Surfaces {
  return {
    sunken: buildSurfaceLevel(neutralRamp, ELEVATION_POSITIONS.sunken, polarity),
    base: buildSurfaceLevel(neutralRamp, ELEVATION_POSITIONS.base, polarity),
    raised: buildSurfaceLevel(neutralRamp, ELEVATION_POSITIONS.raised, polarity),
    overlay: buildSurfaceLevel(neutralRamp, ELEVATION_POSITIONS.overlay, polarity),
    floating: buildSurfaceLevel(neutralRamp, ELEVATION_POSITIONS.floating, polarity),
  };
}
