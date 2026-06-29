/**
 * token-ref.ts — Typed palette accessor and color reference primitives.
 *
 * Replaces the stringly-typed `'scale.step'` / `'mix(...)' ref DSL used in
 * semantic-template.ts and syntax-template.ts with a proper TypeScript API.
 *
 * Key exports:
 *   RefNode        — discriminated union that the resolvers switch on
 *   ColorRef       — chainable wrapper around a RefNode with .mix() and .alpha()
 *   t              — typed palette accessor: t.neutral[1] … t.neutral[12], t.accent.contrast
 *   literal()      — escape hatch for raw CSS color strings
 *   defineSemantics / defineSyntax — identity helpers that pin template types
 *
 * No colorjs.io, no Scales dependency — this file belongs to the `contract`
 * layer and must stay importable without pulling in the generation runtime.
 */

import type { ScaleName, Step, SyntaxRole } from './roles';
import { SCALE_NAMES, STEPS } from './roles';

// ── RefNode discriminated union ────────────────────────────────────────────────

export type RefNode =
  | { kind: 'step'; scale: ScaleName; step: Step }
  | { kind: 'contrast'; scale: ScaleName }
  | { kind: 'mix'; space: 'srgb' | 'oklch'; base: RefNode; pct: number; other: RefNode }
  | { kind: 'alpha'; base: RefNode; alpha: number }
  | { kind: 'literal'; value: string };

// ── ColorRef ──────────────────────────────────────────────────────────────────

export interface ColorRef {
  readonly node: RefNode;
  /**
   * Produce a CSS color-mix() expression: color-mix(in <space>, this <pct>%, other).
   * Defaults to srgb interpolation, matching the current DSL behaviour.
   */
  mix(pct: number, other: ColorRef, space?: 'srgb' | 'oklch'): ColorRef;
  /** Produce a CSS color-mix() expression that applies alpha/opacity. */
  alpha(a: number): ColorRef;
}

function makeColorRef(node: RefNode): ColorRef {
  return {
    node,
    mix(pct, other, space = 'srgb') {
      return makeColorRef({ kind: 'mix', space, base: node, pct, other: other.node });
    },
    alpha(a) {
      return makeColorRef({ kind: 'alpha', base: node, alpha: a });
    },
  };
}

// ── Typed palette accessor ────────────────────────────────────────────────────

type ScaleAccessor = { readonly [S in Step]: ColorRef } & { readonly contrast: ColorRef };

function makeScaleAccessor(scale: ScaleName): ScaleAccessor {
  const accessor: Record<string | number, ColorRef> = {
    contrast: makeColorRef({ kind: 'contrast', scale }),
  };
  for (const step of STEPS) {
    accessor[step] = makeColorRef({ kind: 'step', scale, step });
  }
  return accessor as ScaleAccessor;
}

/**
 * Typed palette accessor for use in semantic and syntax templates.
 *
 *   t.neutral[1]   … t.neutral[12]   — palette step refs
 *   t.accent.contrast                 — contrast-on-solid color
 *
 * Invalid scale name or step number is a TypeScript compile error.
 */
export const t: { readonly [S in ScaleName]: ScaleAccessor } = Object.fromEntries(
  SCALE_NAMES.map((scale) => [scale, makeScaleAccessor(scale)])
) as { readonly [S in ScaleName]: ScaleAccessor };

/** Wrap a raw CSS color string for the rare case where a literal value is needed. */
export const literal = (value: string): ColorRef => makeColorRef({ kind: 'literal', value });

// ── Template definition helpers ───────────────────────────────────────────────

/**
 * Identity helper that pins the semantic template type.
 * Preserves exact string-literal keys (used by contract.css.ts via Object.keys)
 * and enforces ColorRef values at compile time.
 */
export const defineSemantics = <const T extends Record<string, ColorRef>>(tpl: T): T => tpl;

// ── Syntax scope entry (defined here to avoid circular deps with syntax-template) ──

export type SyntaxScopeEntry = {
  /** TextMate grammar scope selectors resolved by Shiki. */
  scopes: string[];
  /** Default palette ref for light-polarity themes. */
  lightDefault: ColorRef;
  /** Default palette ref for dark-polarity themes. */
  darkDefault: ColorRef;
};

/**
 * Identity helper that pins the syntax template type.
 * Enforces SyntaxRole keys and SyntaxScopeEntry values at compile time.
 */
export const defineSyntax = <const T extends Record<SyntaxRole, SyntaxScopeEntry>>(tpl: T): T =>
  tpl;
