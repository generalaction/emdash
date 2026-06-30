/**
 * generate/resolve.ts
 *
 * Resolves the role-stable semantic template against a generated palette
 * (Scales + Surfaces) to produce a concrete CSS custom-property map.
 *
 * Ref syntax handled:
 *   "scale.step"       → scale.steps[step-1]
 *   "scale.contrast"   → scale.contrast
 *   "mix(A pct%, B)"   → emitted as CSS color-mix(in srgb, var(--A) pct%, var(--B))
 */

import Color from 'colorjs.io';
import {
  SURFACE_SCOPES,
  SURFACE_STATUSES,
  STATUS_SCALE,
  STATUS_LEVEL_SCOPES,
} from '../contract/roles';
import type { Scales, Surfaces, Polarity } from '../contract/roles';
import { SEMANTIC_TEMPLATE } from '../contract/semantic-template';
import { toP3String } from './color-format';
import { shiftOklabL } from './surfaces';

// ── Ref resolution ────────────────────────────────────────────────────────────

function resolveRef(ref: string, scales: Scales, _surfaces: Surfaces): string {
  // mix() refs: kept as CSS color-mix expressions for runtime flexibility
  if (ref.startsWith('mix(')) {
    // e.g. "mix(neutral.11 40%, neutral.12)"
    // → "color-mix(in srgb, var(--neutral-11) 40%, var(--neutral-12))"
    const inner = ref.slice(4, -1); // strip "mix(" and ")"
    const parts = inner.split(',').map((s) => s.trim());
    const resolved = parts.map((part) => {
      const match = part.match(/^([\w-]+\.\d+)\s+(\d+%?)$/);
      if (match) {
        const varName = match[1].replace('.', '-'); // "neutral.11" → "neutral-11"
        return `var(--${varName}) ${match[2]}`;
      }
      // No percentage: just a reference
      const varName = part.replace('.', '-');
      return `var(--${varName})`;
    });
    return `color-mix(in srgb, ${resolved.join(', ')})`;
  }

  const [scaleName, stepOrContrast] = ref.split('.') as [string, string];

  // Surface refs
  if (scaleName === 'surface') {
    // e.g. "surface.base" or "surface.base.hover"
    // These are handled separately; not expected in semantic template
    return ref;
  }

  const scale = scales[scaleName as keyof Scales];
  if (!scale) {
    throw new Error(`resolve: unknown scale "${scaleName}" in ref "${ref}"`);
  }

  if (stepOrContrast === 'contrast') return scale.contrast;

  const stepNum = parseInt(stepOrContrast, 10);
  if (isNaN(stepNum) || stepNum < 1 || stepNum > 12) {
    throw new Error(`resolve: invalid step "${stepOrContrast}" in ref "${ref}"`);
  }

  return scale.steps[stepNum - 1];
}

// ── Surface vars ──────────────────────────────────────────────────────────────

function buildSurfaceVars(surfaces: Surfaces): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const scopeName of SURFACE_SCOPES) {
    const level = surfaces[scopeName];
    vars[`--surface-${scopeName}`] = level.base;
    vars[`--surface-${scopeName}-hover`] = level.hover;
    vars[`--surface-${scopeName}-selected`] = level.selected;
  }
  return vars;
}

// ── Status surface vars (--surface-destructive, --surface-warning, etc.) ──────

/**
 * Derives tinted status surface tokens from the named palette ramps.
 * Steps follow the Radix semantic convention:
 *   3 = subtle background, 4 = hover, 5 = selected/active,
 *   6 = border, 11 = readable foreground text.
 *
 * Also emits per-elevation-scope variants for every non-base scope.
 * Each variant is the base token shifted by the OKLab L delta between that
 * scope's neutral surface and the neutral base surface, so status rooms
 * track the canvas lightness without losing internal hover/selected contrast.
 */
function buildStatusSurfaceVars(scales: Scales, surfaces: Surfaces): Record<string, string> {
  const vars: Record<string, string> = {};

  // Pre-compute the OKLab L of the neutral base surface once.
  const neutralBaseL = new Color(surfaces['base'].base).to('oklab').coords[0];

  for (const status of SURFACE_STATUSES) {
    const scaleName = STATUS_SCALE[status];
    const ramp = scales[scaleName];

    // Base (default, unsuffixed) tokens — these remain the effective cascade defaults.
    const baseColor = ramp.steps[2]; // step 3
    const hoverColor = ramp.steps[3]; // step 4
    const selectedColor = ramp.steps[4]; // step 5
    const borderColor = ramp.steps[5]; // step 6
    const fgColor = ramp.steps[10]; // step 11

    vars[`--surface-${status}`] = baseColor;
    vars[`--surface-${status}-hover`] = hoverColor;
    vars[`--surface-${status}-selected`] = selectedColor;
    vars[`--surface-${status}-border`] = borderColor;
    vars[`--surface-${status}-foreground`] = fgColor;

    // Per-scope variants: shift every sub-token by the neutral elevation delta.
    for (const scope of STATUS_LEVEL_SCOPES) {
      const neutralScopeL = new Color(surfaces[scope].base).to('oklab').coords[0];
      const deltaL = neutralScopeL - neutralBaseL;

      const shift = (cssColor: string) => {
        const c = new Color(cssColor);
        const shifted = shiftOklabL(c, deltaL);
        // Gamut-map to P3 if needed (same pattern as buildSurfaceLevel).
        const p3 = shifted.inGamut('p3') ? shifted : (shifted.toGamut({ space: 'p3' }) as Color);
        return toP3String(p3.to('p3') as Color);
      };

      vars[`--surface-${status}-${scope}`] = shift(baseColor);
      vars[`--surface-${status}-${scope}-hover`] = shift(hoverColor);
      vars[`--surface-${status}-${scope}-selected`] = shift(selectedColor);
      vars[`--surface-${status}-${scope}-border`] = shift(borderColor);
      vars[`--surface-${status}-${scope}-foreground`] = shift(fgColor);
    }
  }
  return vars;
}

// ── Palette vars (the --neutral-1..12 etc. ramp vars) ─────────────────────────

function buildPaletteVars(scales: Scales): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [scaleName, ramp] of Object.entries(scales)) {
    ramp.steps.forEach((color: string, i: number) => {
      vars[`--${scaleName}-${i + 1}`] = color;
    });
    vars[`--${scaleName}-contrast`] = ramp.contrast;
  }
  return vars;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Resolve the semantic template against the generated palette.
 * Returns a record of CSS custom property name → resolved color string.
 * Includes palette vars (--neutral-1..12 etc.) and surface vars.
 */
export function resolveCssVars(
  scales: Scales,
  surfaces: Surfaces,
  _polarity: Polarity
): Record<string, string> {
  const vars: Record<string, string> = {};

  // 1. Palette ramp vars (--neutral-1..12, --accent-1..12, etc.)
  Object.assign(vars, buildPaletteVars(scales));

  // 2. Surface elevation vars (--surface-base, --surface-base-hover, etc.)
  Object.assign(vars, buildSurfaceVars(surfaces));

  // 3. Status surface vars (--surface-destructive, --surface-warning, etc.)
  Object.assign(vars, buildStatusSurfaceVars(scales, surfaces));

  // 4. Semantic slot vars (--background, --foreground, etc.)
  for (const [slot, ref] of Object.entries(SEMANTIC_TEMPLATE)) {
    vars[`--${slot}`] = resolveRef(ref, scales, surfaces);
  }

  return vars;
}
