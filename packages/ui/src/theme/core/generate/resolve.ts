/**
 * generate/resolve.ts
 *
 * Resolves the role-stable semantic template against a generated palette
 * (Scales + Surfaces) to produce a concrete CSS custom-property map.
 *
 * RefNode kinds and their emitted output:
 *   step     → concrete CSS color resolved from Scales (gamut-correct P3/sRGB value)
 *   contrast → concrete CSS color (the auto-computed contrast-on-solid color)
 *   mix      → CSS color-mix() expression with var(--…) operands (resolved at paint time)
 *   alpha    → CSS color-mix(in srgb, var(--…) N%, transparent)
 *   literal  → the literal value passed through unchanged
 *
 * Byte-identical output guarantee: step/contrast slots continue to emit the
 * same concrete color values; mix slots continue to emit var()-based
 * color-mix() expressions exactly as the previous string-ref parser did.
 */

import Color from 'colorjs.io';
import {
  STATUS_LEVEL_SCOPES,
  STATUS_SCALE,
  SURFACE_SCOPES,
  SURFACE_STATUSES,
} from '../contract/roles';
import type { Polarity, Scales, Surfaces } from '../contract/roles';
import { semanticVars } from '../contract/semantic-template';
import type { ColorRef, RefNode } from '../contract/token-ref';
import { toP3String } from './color-format';
import { shiftOklabL } from './surfaces';

// ── Node emitters ─────────────────────────────────────────────────────────────

/**
 * Emit a var() reference for a RefNode, used as an operand inside color-mix().
 *   step     → var(--scale-step)
 *   contrast → var(--scale-contrast)
 *   mix/alpha → nested color-mix() expression
 *   literal  → the literal value (used as-is inside color-mix)
 */
function emitVarRef(n: RefNode): string {
  switch (n.kind) {
    case 'step':
      return `var(--${n.scale}-${n.step})`;
    case 'contrast':
      return `var(--${n.scale}-contrast)`;
    case 'mix':
      return `color-mix(in ${n.space}, ${emitVarRef(n.base)} ${n.pct}%, ${emitVarRef(n.other)})`;
    case 'alpha':
      return `color-mix(in srgb, ${emitVarRef(n.base)} ${n.alpha * 100}%, transparent)`;
    case 'literal':
      return n.value;
  }
}

/**
 * Emit the final CSS value for a semantic slot.
 *
 * step/contrast → resolved to the concrete gamut-correct color from Scales,
 *                 keeping generated colors accurate across all themes.
 * mix/alpha     → CSS color-mix() expression that browsers resolve at paint
 *                 time (var() refs allow theme switching via class swap only).
 * literal       → passed through unchanged.
 */
function emitValue(n: RefNode, scales: Scales): string {
  switch (n.kind) {
    case 'step':
      return scales[n.scale].steps[n.step - 1];
    case 'contrast':
      return scales[n.scale].contrast;
    case 'mix':
      return `color-mix(in ${n.space}, ${emitVarRef(n.base)} ${n.pct}%, ${emitVarRef(n.other)})`;
    case 'alpha':
      return `color-mix(in srgb, ${emitVarRef(n.base)} ${n.alpha * 100}%, transparent)`;
    case 'literal':
      return n.value;
  }
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

  const neutralBaseL = new Color(surfaces['base'].base).to('oklab').coords[0];

  for (const status of SURFACE_STATUSES) {
    const scaleName = STATUS_SCALE[status];
    const ramp = scales[scaleName];

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

    for (const scope of STATUS_LEVEL_SCOPES) {
      const neutralScopeL = new Color(surfaces[scope].base).to('oklab').coords[0];
      const deltaL = neutralScopeL - neutralBaseL;

      const shift = (cssColor: string) => {
        const c = new Color(cssColor);
        const shifted = shiftOklabL(c, deltaL);
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
 * Returns a record of CSS custom property name → resolved CSS value string.
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
  for (const [slot, ref] of Object.entries(semanticVars) as [string, ColorRef][]) {
    vars[`--${slot}`] = emitValue(ref.node, scales);
  }

  return vars;
}
