/**
 * generate/surfaces.ts
 *
 * Generates the 5-level surface elevation scale + hover/selected state layers.
 *
 * Elevation always gets lighter (higher OKLCH L) in both modes:
 *   sunken (darkest) → base → base-emphasis → elevated → elevated-emphasis (lightest)
 *
 * Each level is constructed from an absolute OKLCH L target in SURFACE_L,
 * keeping the neutral hue and a reduced chroma tint. Hover/selected states are
 * derived with fixed OKLab ΔL shifts: light surfaces darken on interaction,
 * dark surfaces lighten.
 */

import Color from 'colorjs.io';
import { SURFACE_L, STATE_LAYER_DELTA } from '../contract/targets.js';
import type { Polarity, Ramp, SurfaceScopeName, Surfaces, SurfaceLevel } from '../contract/roles.js';
import { SURFACE_SCOPES } from '../contract/roles.js';

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
 * Build one SurfaceLevel from an absolute OKLCH L target.
 * The hue and reduced chroma come from the neutral ramp's step 1,
 * maintaining any warm/cool tint in the neutral palette.
 * Hover/selected are OKLab ΔL shifts; direction depends on polarity.
 */
function buildSurfaceLevel(
  neutralRamp: Ramp,
  targetL: number,
  polarity: Polarity,
): SurfaceLevel {
  // Derive base color: use the neutral hue + reduced chroma for a subtle tint
  const step1 = new Color(neutralRamp.steps[0]).to('oklch');
  const hue = step1.coords[2] || 0;
  const chroma = Math.max(0, step1.coords[1] * 0.8);

  const baseOklch = new Color('oklch', [targetL, chroma, hue]);
  const baseP3 = baseOklch.inGamut('p3')
    ? baseOklch.to('p3')
    : (baseOklch.toGamut({ space: 'p3' }) as Color).to('p3');

  // Light surfaces darken on interaction; dark surfaces lighten
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
 * Generate the full surface set (5 elevation levels + semantic roles) from the
 * resolved neutral ramp.
 *
 * Elevation levels are ordered darkest → lightest (sunken → elevated-emphasis)
 * in both modes. Roles (e.g. `paper`) are generated the same way but sit outside
 * the ladder. Each surface has base, hover, and selected variants.
 */
export function generateSurfaces(neutralRamp: Ramp, polarity: Polarity): Surfaces {
  const surfaces = {} as Surfaces;
  for (const scope of SURFACE_SCOPES) {
    const targetL = SURFACE_L[polarity][scope as SurfaceScopeName];
    surfaces[scope as SurfaceScopeName] = buildSurfaceLevel(neutralRamp, targetL, polarity);
  }
  return surfaces;
}
