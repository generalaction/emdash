/**
 * config — single source of truth for chat-ui typography, chip geometry,
 * prose geometry, and density.
 *
 * Exports:
 *   ChatConfig     — the one object a host provides (or omits to use defaults).
 *   DEFAULT_CONFIG — the only fallback; all values match today's hard-coded
 *                    constants so a host that omits `config` gets identical output.
 *   ResolvedTheme  — output of buildChatTheme; consumed by ThemeContext/MeasureCtx.
 *   buildChatTheme — derives ResolvedTheme from ChatConfig, call once at creation.
 *
 * Colors / font-family / radii are intentionally excluded from ChatConfig.
 * They remain CSS-themed via the :where() defaults in styles/theme.css.ts and
 * the .emlight/.emdark host override in chat-theme.css so that host apps can
 * rebind them without inline-style specificity fighting class-based overrides.
 * Only the measurement-coupled vars (--chat-type-*, --chat-ic-pad-*) are emitted
 * inline at runtime so they can be driven by the runtime config.
 */

// ── VariantMetrics + FontConfig (measurement-side types) ──────────────────────
//
// Defined here (not in core/measure/fonts.ts) to avoid circular imports between
// config.ts and fonts.ts. core/measure/fonts.ts re-exports both for back-compat.

export type VariantMetrics = {
  font: string;
  lineHeight: number;
};

export type FontConfig = {
  body: VariantMetrics;
  bold: VariantMetrics;
  italic: VariantMetrics;
  boldItalic: VariantMetrics;
  link: VariantMetrics;
  h1: VariantMetrics;
  h2: VariantMetrics;
  h3: VariantMetrics;
  inlineCode: VariantMetrics;
  mention: VariantMetrics;
  code: VariantMetrics;
  /**
   * Total extra horizontal space for an inline-code chip (2 × inlineCodePadX).
   * Fed into pretext's `extraWidth` so shaped widths include the visual chrome.
   */
  inlineCodeExtraWidth: number;
  /**
   * Total extra horizontal space for a plain mention chip (2 × mentionPadX).
   */
  mentionExtraWidth: number;
  /**
   * Width reserved for the resolved-mention icon container (px).
   * Must equal ChipConfig.mentionIconW — read by to-rich-items and Prose.tsx.
   */
  mentionIconW: number;
  /**
   * Gap between mention icon and mention label text (px).
   * Must equal ChipConfig.mentionIconGap — read by to-rich-items and Prose.tsx.
   */
  mentionIconGap: number;
};

// ── Font families ─────────────────────────────────────────────────────────────

export type FontFamilies = {
  sans: string[];
  mono: string[];
};

// ── Type roles ────────────────────────────────────────────────────────────────

export type RoleName =
  | 'body'
  | 'body-bold'
  | 'body-italic'
  | 'body-link'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'inline-code'
  | 'mention'
  | 'code'
  | 'code-lang';

export type TypeRole = {
  family: 'sans' | 'mono';
  /** px */
  size: number;
  weight: number;
  /** px */
  lineHeight: number;
  style?: 'italic';
};

// ── Chip geometry ─────────────────────────────────────────────────────────────

export type ChipConfig = {
  /** Horizontal padding inside the inline-code chip (px). */
  inlineCodePadX: number;
  /** Vertical padding inside the inline-code chip (px). */
  inlineCodePadY: number;
  /** Horizontal padding inside the mention chip (px). */
  mentionPadX: number;
  /** Vertical padding inside the mention chip (px). */
  mentionPadY: number;
  /** Width reserved for the resolved-mention icon container (px). */
  mentionIconW: number;
  /** Gap between mention icon and mention label text (px). */
  mentionIconGap: number;
};

// ── Prose geometry ────────────────────────────────────────────────────────────

export type ProseConfig = {
  /** Horizontal indent per nesting level for list items (px). */
  listIndent: number;
  /** Horizontal indent per nesting level for blockquotes (px). */
  blockquoteIndent: number;
  /** Gap from bullet center-anchor to list item text start (px). */
  listBulletGap: number;
};

// ── Density ───────────────────────────────────────────────────────────────────

export type DensityScale = {
  /** Gap between consecutive blocks of different tiers (code, table) in a block stack. */
  blockGap: number;
  /** Tighter gap between two consecutive prose blocks. */
  proseGap: number;
  /** Uniform vertical gap (px) between consecutive transcript row groups. */
  rowGap: number;
  /** Standard single-line row height (px) for tool/plan/diff header rows. */
  rowH: number;
  /** Horizontal inset (px) applied to both sides of non-user-message rows. */
  rowInsetX: number;
  /**
   * Extra vertical space (px) added to body line-height to produce the
   * collapsible header row height.
   */
  headerRowExtraH: number;
};

// ── ChatConfig ────────────────────────────────────────────────────────────────

export type ChatConfig = {
  fonts: FontFamilies;
  roles: Record<RoleName, TypeRole>;
  chips: ChipConfig;
  prose: ProseConfig;
  density: DensityScale;
};

// ── ResolvedTheme ─────────────────────────────────────────────────────────────

/**
 * Output of buildChatTheme — provided via ThemeContext and threaded into every
 * MeasureCtx.theme. `version` is bumped per buildChatTheme call so blockMemo
 * fingerprints detect invalidation without deep equality.
 */
export type ResolvedTheme = {
  version: number;
  config: ChatConfig;
  /** Pretext measurement side: font shorthands + derived extras. */
  fonts: FontConfig;
  density: DensityScale;
  prose: ProseConfig;
  chips: ChipConfig;
  /**
   * CSS custom property values for the measurement-coupled --chat-type-* and
   * --chat-ic-pad-* vars. Keyed by raw CSS property names.
   * Applied inline at the scroll-container root by ChatRoot.onMount.
   * Colors, radii, and font-family vars are excluded (they stay CSS-class-themed).
   */
  cssVars: Record<string, string>;
};

// ── DEFAULT_CONFIG ────────────────────────────────────────────────────────────

/**
 * The only fallback for chat-ui styling. Values are byte-identical to the
 * previously hard-coded constants scattered across tokens.ts, metrics.ts, and
 * core/theme.ts. A host that does not pass a custom config gets this.
 */
export const DEFAULT_CONFIG: ChatConfig = {
  fonts: {
    sans: ['Inter Variable', 'sans-serif'],
    mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
  },
  roles: {
    body: { family: 'sans', size: 14, weight: 400, lineHeight: 20 },
    'body-bold': { family: 'sans', size: 14, weight: 600, lineHeight: 20 },
    'body-italic': { family: 'sans', size: 14, weight: 400, lineHeight: 20, style: 'italic' },
    'body-link': { family: 'sans', size: 14, weight: 400, lineHeight: 20 },
    h1: { family: 'sans', size: 20, weight: 600, lineHeight: 28 },
    h2: { family: 'sans', size: 17, weight: 600, lineHeight: 25 },
    h3: { family: 'sans', size: 14, weight: 600, lineHeight: 22 },
    'inline-code': { family: 'mono', size: 12, weight: 400, lineHeight: 20 },
    mention: { family: 'sans', size: 12, weight: 500, lineHeight: 20 },
    code: { family: 'mono', size: 13, weight: 400, lineHeight: 20 },
    'code-lang': { family: 'sans', size: 11, weight: 500, lineHeight: 16 },
  },
  chips: {
    inlineCodePadX: 6,
    inlineCodePadY: 2,
    mentionPadX: 4,
    mentionPadY: 2,
    mentionIconW: 14,
    mentionIconGap: 4,
  },
  prose: {
    listIndent: 16,
    blockquoteIndent: 18,
    listBulletGap: 12,
  },
  density: {
    blockGap: 10,
    proseGap: 4,
    rowGap: 8,
    rowH: 32,
    rowInsetX: 16,
    headerRowExtraH: 8,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function familyCss(config: ChatConfig, family: 'sans' | 'mono'): string {
  return (family === 'mono' ? config.fonts.mono : config.fonts.sans).join(', ');
}

/** Build a CSS font shorthand string (style? weight size family). */
export function fontShorthand(role: TypeRole, familyCssStr: string): string {
  const stylePrefix = role.style ? `${role.style} ` : '';
  return `${stylePrefix}${role.weight} ${role.size}px ${familyCssStr}`;
}

function toVariantMetrics(role: TypeRole, familyCssStr: string): VariantMetrics {
  return { font: fontShorthand(role, familyCssStr), lineHeight: role.lineHeight };
}

/**
 * Derive a FontConfig (pretext measurement side) from a ChatConfig.
 * Both `boldItalic` and `body-bold` read the same weight; boldItalic adds italic style.
 */
export function toFontConfig(config: ChatConfig): FontConfig {
  const sans = familyCss(config, 'sans');
  const mono = familyCss(config, 'mono');
  const r = config.roles;

  return {
    body: toVariantMetrics(r.body, sans),
    bold: toVariantMetrics(r['body-bold'], sans),
    italic: toVariantMetrics(r['body-italic'], sans),
    boldItalic: {
      font: fontShorthand({ ...r['body-bold'], style: 'italic' }, sans),
      lineHeight: r['body-bold'].lineHeight,
    },
    link: toVariantMetrics(r['body-link'], sans),
    h1: toVariantMetrics(r.h1, sans),
    h2: toVariantMetrics(r.h2, sans),
    h3: toVariantMetrics(r.h3, sans),
    inlineCode: toVariantMetrics(r['inline-code'], mono),
    mention: toVariantMetrics(r.mention, sans),
    code: toVariantMetrics(r.code, mono),
    inlineCodeExtraWidth: 2 * config.chips.inlineCodePadX,
    mentionExtraWidth: 2 * config.chips.mentionPadX,
    mentionIconW: config.chips.mentionIconW,
    mentionIconGap: config.chips.mentionIconGap,
  };
}

/**
 * Map a ChatConfig to the measurement-coupled CSS custom property values
 * (--chat-type-* and --chat-ic-pad-*). Does NOT include color, radii, or
 * font-family vars — those remain CSS-class-themed.
 *
 * Returns raw CSS custom property names as keys so ChatRoot can emit them
 * via el.style.setProperty. The :where() defaults in theme.css.ts derive
 * their values from DEFAULT_CONFIG using the same property name keys.
 */
export function toCssVars(config: ChatConfig): Record<string, string> {
  const r = config.roles;
  const c = config.chips;

  function px(n: number): string {
    return `${n}px`;
  }

  // Font-family values reference the global CSS vars so the host can override
  // the families via --chat-font-sans / --chat-font-mono without re-running
  // buildChatTheme. These vars are handled in the :where() / class-override
  // layer, so we only emit the family values as references here.
  const sansFamilyVar = 'var(--chat-font-sans)';
  const monoFamilyVar = 'var(--chat-font-mono)';

  return {
    '--chat-type-body-font-family': sansFamilyVar,
    '--chat-type-body-font-size': px(r.body.size),
    '--chat-type-body-font-weight': String(r.body.weight),
    '--chat-type-body-line-height': px(r.body.lineHeight),

    '--chat-type-body-bold-font-family': sansFamilyVar,
    '--chat-type-body-bold-font-size': px(r['body-bold'].size),
    '--chat-type-body-bold-font-weight': String(r['body-bold'].weight),
    '--chat-type-body-bold-line-height': px(r['body-bold'].lineHeight),

    '--chat-type-body-italic-font-family': sansFamilyVar,
    '--chat-type-body-italic-font-size': px(r['body-italic'].size),
    '--chat-type-body-italic-font-weight': String(r['body-italic'].weight),
    '--chat-type-body-italic-font-style': r['body-italic'].style ?? 'normal',
    '--chat-type-body-italic-line-height': px(r['body-italic'].lineHeight),

    '--chat-type-body-link-font-family': sansFamilyVar,
    '--chat-type-body-link-font-size': px(r['body-link'].size),
    '--chat-type-body-link-font-weight': String(r['body-link'].weight),
    '--chat-type-body-link-line-height': px(r['body-link'].lineHeight),

    '--chat-type-h1-font-family': sansFamilyVar,
    '--chat-type-h1-font-size': px(r.h1.size),
    '--chat-type-h1-font-weight': String(r.h1.weight),
    '--chat-type-h1-line-height': px(r.h1.lineHeight),

    '--chat-type-h2-font-family': sansFamilyVar,
    '--chat-type-h2-font-size': px(r.h2.size),
    '--chat-type-h2-font-weight': String(r.h2.weight),
    '--chat-type-h2-line-height': px(r.h2.lineHeight),

    '--chat-type-h3-font-family': sansFamilyVar,
    '--chat-type-h3-font-size': px(r.h3.size),
    '--chat-type-h3-font-weight': String(r.h3.weight),
    '--chat-type-h3-line-height': px(r.h3.lineHeight),

    '--chat-type-inline-code-font-family': monoFamilyVar,
    '--chat-type-inline-code-font-size': px(r['inline-code'].size),
    '--chat-type-inline-code-font-weight': String(r['inline-code'].weight),
    '--chat-type-inline-code-line-height': px(r['inline-code'].lineHeight),

    '--chat-type-code-font-family': monoFamilyVar,
    '--chat-type-code-font-size': px(r.code.size),
    '--chat-type-code-font-weight': String(r.code.weight),
    '--chat-type-code-line-height': px(r.code.lineHeight),

    '--chat-type-code-lang-font-family': sansFamilyVar,
    '--chat-type-code-lang-font-size': px(r['code-lang'].size),
    '--chat-type-code-lang-font-weight': String(r['code-lang'].weight),
    '--chat-type-code-lang-line-height': px(r['code-lang'].lineHeight),

    '--chat-type-mention-font-family': sansFamilyVar,

    '--chat-ic-pad-x': px(c.inlineCodePadX),
    '--chat-ic-pad-y': px(c.inlineCodePadY),
  };
}

// ── Builder ───────────────────────────────────────────────────────────────────

let _version = 0;

/**
 * Derive a ResolvedTheme from a ChatConfig. Call once at app creation time.
 * The result is passed as `theme` to ChatRoot (or stored as DEFAULT_THEME).
 * `version` increments on each call so blockMemo fingerprints self-invalidate.
 */
export function buildChatTheme(config: ChatConfig = DEFAULT_CONFIG): ResolvedTheme {
  return {
    version: ++_version,
    config,
    fonts: toFontConfig(config),
    density: config.density,
    prose: config.prose,
    chips: config.chips,
    cssVars: toCssVars(config),
  };
}
