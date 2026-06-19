/**
 * resolve.ts
 *
 * Resolves the role-stable semantic template against a generated palette
 * (Scales + Surfaces) to produce a concrete CSS custom-property map.
 *
 * Ref syntax handled:
 *   "scale.step"       → scale.steps[step-1]
 *   "scale.contrast"   → scale.contrast
 *   "mix(A pct%, B)"   → emitted as CSS color-mix(in srgb, var(--A) pct%, var(--B))
 */

import { SEMANTIC_TEMPLATE } from './contract/semantic-template.js';
import { SURFACE_LEVELS, SURFACE_STATUSES, STATUS_SCALE } from './contract/roles.js';
import type { Scales, Surfaces, Polarity } from './contract/roles.js';

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
  // Iterate in canonical order (darkest → lightest) via SURFACE_LEVELS
  for (const levelName of SURFACE_LEVELS) {
    const level = surfaces[levelName];
    vars[`--surface-${levelName}`] = level.base;
    vars[`--surface-${levelName}-hover`] = level.hover;
    vars[`--surface-${levelName}-selected`] = level.selected;
  }
  return vars;
}

// ── Status surface vars (--surface-destructive, --surface-warning, etc.) ──────

/**
 * Derives tinted status surface tokens from the named palette ramps.
 * Steps follow the Radix semantic convention:
 *   3 = subtle background, 4 = hover, 5 = selected/active,
 *   6 = border, 11 = readable foreground text.
 */
function buildStatusSurfaceVars(scales: Scales): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const status of SURFACE_STATUSES) {
    const scaleName = STATUS_SCALE[status];
    const ramp = scales[scaleName];
    vars[`--surface-${status}`] = ramp.steps[2]; // step 3
    vars[`--surface-${status}-hover`] = ramp.steps[3]; // step 4
    vars[`--surface-${status}-selected`] = ramp.steps[4]; // step 5
    vars[`--surface-${status}-border`] = ramp.steps[5]; // step 6
    vars[`--surface-${status}-foreground`] = ramp.steps[10]; // step 11
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
  _polarity: Polarity,
): Record<string, string> {
  const vars: Record<string, string> = {};

  // 1. Palette ramp vars (--neutral-1..12, --accent-1..12, etc.)
  Object.assign(vars, buildPaletteVars(scales));

  // 2. Surface elevation vars (--surface-base, --surface-base-hover, etc.)
  Object.assign(vars, buildSurfaceVars(surfaces));

  // 3. Status surface vars (--surface-destructive, --surface-warning, etc.)
  Object.assign(vars, buildStatusSurfaceVars(scales));

  // 4. Semantic slot vars (--background, --foreground, etc.)
  for (const [slot, ref] of Object.entries(SEMANTIC_TEMPLATE)) {
    vars[`--${slot}`] = resolveRef(ref, scales, surfaces);
  }

  return vars;
}
