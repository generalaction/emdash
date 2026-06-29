/**
 * Role-stable semantic template: maps every CSS custom-property slot to a
 * typed ColorRef. Written once, never branched per theme or polarity.
 *
 * This is the ONLY place semantics are assigned. Scales are hue-named in the
 * palette (green, red, amber, blue, orange, purple); here we say what each hue
 * means (success → green, error → red, merged → purple, conflict → orange, …).
 *
 * ColorRef kinds used here:
 *   t.<scale>[<step>]          — resolves to the concrete color at that step
 *   t.<scale>.contrast         — the auto-computed contrast-on-solid color
 *   t.<scale>[n].mix(pct, ...) — CSS color-mix() expression (resolved at paint time)
 *
 * Slot keys are stable kebab-case CSS custom property names (without the leading --).
 * contract.css.ts derives the VE vars contract from Object.keys() of this object,
 * so keys must never be renamed without a corresponding CSS migration.
 */

import { nsName } from './namespace';
import { defineSemantics, t } from './token-ref';

export const semanticVars = defineSemantics({
  // ── Backgrounds ───────────────────────────────────────────────────────────
  background: t.neutral[1],
  'background-1': t.neutral[2],
  'background-2': t.neutral[3],
  'background-3': t.neutral[4],

  // ── Foregrounds ───────────────────────────────────────────────────────────
  foreground: t.neutral[12],
  'foreground-inverse': t.neutral[1],
  /** Resolved as color-mix(in srgb, var(--neutral-11) 40%, var(--neutral-12)) */
  'foreground-body': t.neutral[11].mix(40, t.neutral[12]),
  'foreground-muted': t.neutral[11],
  'foreground-passive': t.neutral[9],

  // ── Secondary (sidebar / secondary panels) ────────────────────────────────
  'background-secondary': t.neutral[2],
  'background-secondary-1': t.neutral[1],
  'background-secondary-2': t.neutral[4],
  'background-secondary-3': t.neutral[6],

  'foreground-secondary': t.neutral[12],
  'foreground-secondary-muted': t.neutral[11],
  'foreground-secondary-passive': t.neutral[9],

  // ── Tertiary (code editors / inset panels) ────────────────────────────────
  'background-tertiary': t.neutral[3],
  'background-tertiary-1': t.neutral[4],
  'background-tertiary-2': t.neutral[5],
  'background-tertiary-3': t.neutral[6],

  'foreground-tertiary': t.neutral[12],
  'foreground-tertiary-muted': t.neutral[11],
  'foreground-tertiary-passive': t.neutral[9],

  // ── Quaternary ────────────────────────────────────────────────────────────
  'background-quaternary': t.neutral[1],
  'background-quaternary-1': t.neutral[2],
  'background-quaternary-2': t.neutral[3],

  // ── Neutral (inverted / pill) ─────────────────────────────────────────────
  'background-neutral': t.neutral[12],
  'foreground-neutral': t.neutral[1],

  // ── Primary button ────────────────────────────────────────────────────────
  'primary-button-background': t.accent[9],
  'primary-button-background-hover': t.accent[10],
  'primary-button-foreground': t.accent.contrast,
  'primary-button-border': t.accent[7],

  // ── Destructive (red) ─────────────────────────────────────────────────────
  'background-destructive': t.red[3],
  'background-destructive-1': t.red[2],
  'foreground-destructive': t.red[11],
  'foreground-destructive-muted': t.red[9],

  // ── Borders ───────────────────────────────────────────────────────────────
  border: t.neutral[6],
  'border-1': t.neutral[7],
  'border-2': t.neutral[8],
  'border-destructive': t.red[8],
  'border-primary': t.neutral[9],

  // ── Selection (blue) ──────────────────────────────────────────────────────
  selection: t.blue[6],
  'selection-foreground': t.blue[12],

  // ── Status ────────────────────────────────────────────────────────────────
  'status-in-progress': t.amber[11],
  'status-in-review': t.green[10],
  'status-done': t.neutral[9],
  'status-todo': t.neutral[9],
  'status-cancelled': t.neutral[9],

  // ── Diff ──────────────────────────────────────────────────────────────────
  'foreground-diff-added': t.green[9],
  'foreground-diff-modified': t.amber[9],
  'foreground-diff-deleted': t.red[9],

  // ── Semantic state sets ───────────────────────────────────────────────────
  // success → green
  'foreground-success': t.green[9],
  'background-success': t.green[3],
  'background-success-hover': t.green[4],
  'border-success': t.green[7],

  // error → red
  'foreground-error': t.red[9],
  'background-error': t.red[3],
  'background-error-hover': t.red[4],
  'border-error': t.red[7],

  // warning → amber
  'foreground-warning': t.amber[11],
  'background-warning': t.amber[3],
  'background-warning-hover': t.amber[4],
  'border-warning': t.amber[7],

  // info → blue
  'foreground-info': t.blue[9],
  'background-info': t.blue[3],
  'background-info-hover': t.blue[4],
  'border-info': t.blue[7],

  // ── VCS state extras ──────────────────────────────────────────────────────
  // merge conflict → orange; merged PR → purple (GitHub convention)
  'foreground-conflict': t.orange[11],
  'foreground-merged': t.purple[9],
});

export type SemanticSlot = keyof typeof semanticVars;
/** Namespaced CSS custom property name for a semantic slot (e.g. "--em-background"). */
export type SemanticVar = string;

/** Array of all semantic CSS custom property names (namespaced) for runtime validation. */
export const SEMANTIC_VARS: readonly string[] = Object.keys(semanticVars).map((k) => nsName(k));
