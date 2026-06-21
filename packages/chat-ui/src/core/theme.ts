import type { FontConfig } from './measure/fonts';
import { DEFAULT_FONT_CONFIG } from './measure/fonts';

// ── Density scale ─────────────────────────────────────────────────────────────

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
  /** Vertical padding of the inline-code chip (px). Emitted as `--chat-ic-pad-y`. */
  inlineCodePadY: number;
  /**
   * Uniform vertical gap (px) between consecutive transcript row groups.
   * Applied as gapBefore on the first unit of each group by flatten().
   * Must equal the ROW_GAP value used in UnitRow padding calculations.
   */
  rowGap: number;
  /**
   * Standard single-line row height (px) shared by tool, file-op, plan header,
   * diff header, and resource-link rows.
   */
  rowH: number;
  /**
   * Horizontal inset (px) applied to both sides of non-user-message rows.
   * Subtracted from rowWidth before measure() so block heights use the correct width.
   */
  rowInsetX: number;
  /**
   * Extra vertical space (px) added to the body line-height to produce the
   * standard single-line collapsible header row height.
   * header height = theme.fonts.body.lineHeight + headerRowExtraH
   */
  headerRowExtraH: number;
};

// ── ChatTheme ─────────────────────────────────────────────────────────────────

export type ChatTheme = {
  /**
   * Monotonically-increasing integer. Bump this whenever density or fonts change
   * so the node memo fingerprint detects the invalidation without a deep equality check.
   */
  version: number;
  fonts: FontConfig;
  density: DensityScale;
};

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildTheme(fonts: FontConfig = DEFAULT_FONT_CONFIG): ChatTheme {
  const density: DensityScale = {
    blockGap: 10,
    proseGap: 4,
    inlineCodePadX: 6,
    inlineCodePadY: 2,
    rowGap: 8,
    rowH: 32,
    rowInsetX: 16,
    headerRowExtraH: 8,
  };

  return { version: 1, fonts, density };
}

export const DEFAULT_THEME: ChatTheme = buildTheme();
