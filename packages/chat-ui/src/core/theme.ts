/**
 * ChatTheme — single injection interface for all external measurement inputs.
 *
 * Carries typography (`fonts`) and a minimal density scale (`density`) with
 * only the values that are *shared across multiple components* — i.e. used by
 * at least two unrelated def files or by both a def and the CSS variable shim.
 *
 * Component-internal constants (row heights, borders, paddings specific to a
 * single component) live as module consts in their respective def files.
 *
 * `version` is bumped (by the caller) whenever any value changes so the
 * identity-based node memo in the registry can detect theme invalidation.
 */

import type { FontConfig } from './measure/fonts';
import { DEFAULT_FONT_CONFIG } from './measure/fonts';

// ── Density scale ─────────────────────────────────────────────────────────────

/**
 * Cross-cutting density constants shared across multiple components or between
 * a component def and the CSS-variable shim in ChatRoot.
 *
 * Keep this list minimal — if a constant is only used by one component, it
 * belongs in that component's def file, not here.
 */
export type DensityScale = {
  /** Gap between consecutive blocks of different tiers (code, table) in a block stack. */
  blockGap: number;
  /** Tighter gap between two consecutive prose blocks (replaces blockGap when both are prose). */
  proseGap: number;
  /**
   * Horizontal padding added by the inline-code chip on each side (px).
   * Used by both: the pretext shaping pass (FontConfig.inlineCodeExtraWidth is
   * computed from this) and the CSS variable `--chat-ic-pad-x` emitted by ChatRoot.
   */
  inlineCodePadX: number;
  /**
   * Vertical padding of the inline-code chip (px).
   * Emitted as `--chat-ic-pad-y` by ChatRoot.
   */
  inlineCodePadY: number;
};

// ── ChatTheme ─────────────────────────────────────────────────────────────────

export type ChatTheme = {
  /**
   * Monotonically-increasing integer. Bump this (by cloning with a new version)
   * whenever density or fonts change so the node memo fingerprint detects the
   * invalidation without a deep equality check.
   */
  version: number;
  fonts: FontConfig;
  density: DensityScale;
};

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Assemble a self-consistent ChatTheme from a FontConfig.
 *
 * Density defaults are literal px values matching the historical per-component
 * metrics.ts values; they should only need changing for a full density retheme.
 */
export function buildTheme(fonts: FontConfig = DEFAULT_FONT_CONFIG): ChatTheme {
  const density: DensityScale = {
    blockGap: 10,
    proseGap: 4,
    inlineCodePadX: 6,
    inlineCodePadY: 2,
  };

  return { version: 1, fonts, density };
}

export const DEFAULT_THEME: ChatTheme = buildTheme();
