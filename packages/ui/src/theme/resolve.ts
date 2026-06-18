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
  for (const [elevName, level] of Object.entries(surfaces)) {
    vars[`--surface-${elevName}`] = level.base;
    vars[`--surface-${elevName}-hover`] = level.hover;
    vars[`--surface-${elevName}-selected`] = level.selected;
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

  // 3. Semantic slot vars (--background, --foreground, etc.)
  for (const [slot, ref] of Object.entries(SEMANTIC_TEMPLATE)) {
    vars[`--${slot}`] = resolveRef(ref, scales, surfaces);
  }

  return vars;
}
