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
  /** Uniform vertical gap (px) between consecutive transcript row groups (user<->assistant boundary). */
  rowGap: number;
  /**
   * Fallback gap (px) used when a unit kind has no declared margin.
   * Applied as the collapsed intra-turn seam gap between adjacent assistant-turn items.
   */
  turnGap: number;
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
   * Measurement-coupled CSS variable values keyed by the TypeScript contract
   * key names (ThemeVarKey). Applied inline at the scroll-container root by
   * ChatRoot via `assignInlineVars`. Colors, radii, and font-family vars are
   * excluded — they stay CSS-class-themed so host overrides keep working.
   */
  themeVars: Record<ThemeVarKey, string>;
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
    turnGap: 4,
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

// ── ThemeVarKey ───────────────────────────────────────────────────────────────

/**
 * Keys in the global `vars` contract that are driven by runtime ChatConfig
 * (typography metrics + chip padding). Must stay in sync with the `vars`
 * contract shape in styles/theme.css.ts — TypeScript enforces this in ChatRoot
 * via `vars[k as ThemeVarKey]` lookups.
 *
 * Colors, radii, and font-family vars are excluded: they stay CSS-class-themed.
 */
export type ThemeVarKey =
  | 'typeBodyFontFamily'
  | 'typeBodyFontSize'
  | 'typeBodyFontWeight'
  | 'typeBodyLineHeight'
  | 'typeBodyBoldFontFamily'
  | 'typeBodyBoldFontSize'
  | 'typeBodyBoldFontWeight'
  | 'typeBodyBoldLineHeight'
  | 'typeBodyItalicFontFamily'
  | 'typeBodyItalicFontSize'
  | 'typeBodyItalicFontWeight'
  | 'typeBodyItalicFontStyle'
  | 'typeBodyItalicLineHeight'
  | 'typeBodyLinkFontFamily'
  | 'typeBodyLinkFontSize'
  | 'typeBodyLinkFontWeight'
  | 'typeBodyLinkLineHeight'
  | 'typeH1FontFamily'
  | 'typeH1FontSize'
  | 'typeH1FontWeight'
  | 'typeH1LineHeight'
  | 'typeH2FontFamily'
  | 'typeH2FontSize'
  | 'typeH2FontWeight'
  | 'typeH2LineHeight'
  | 'typeH3FontFamily'
  | 'typeH3FontSize'
  | 'typeH3FontWeight'
  | 'typeH3LineHeight'
  | 'typeInlineCodeFontFamily'
  | 'typeInlineCodeFontSize'
  | 'typeInlineCodeFontWeight'
  | 'typeInlineCodeLineHeight'
  | 'typeCodeFontFamily'
  | 'typeCodeFontSize'
  | 'typeCodeFontWeight'
  | 'typeCodeLineHeight'
  | 'typeCodeLangFontFamily'
  | 'typeCodeLangFontSize'
  | 'typeCodeLangFontWeight'
  | 'typeCodeLangLineHeight'
  | 'typeMentionFontFamily'
  | 'typeMentionFontSize'
  | 'typeMentionFontWeight'
  | 'icPadX'
  | 'icPadY'
  | 'mentionPadX'
  | 'mentionPadY';

/**
 * Map a ChatConfig to the measurement-coupled CSS contract values
 * (typography + chip padding). Keys are the TypeScript contract key names from
 * the `vars` object in styles/theme.css.ts so ChatRoot can apply them via
 * `assignInlineVars` with a compile-time link to the contract. Colors, radii,
 * and font-family vars are excluded — they stay CSS-class-themed.
 *
 * Font-family values reference the global CSS vars (var(--chat-font-sans) etc.)
 * so the host can override families via --chat-font-sans / --chat-font-mono
 * without re-running buildChatTheme.
 */
export function toThemeVars(config: ChatConfig): Record<ThemeVarKey, string> {
  const r = config.roles;
  const c = config.chips;

  function px(n: number): string {
    return `${n}px`;
  }

  const sans = 'var(--chat-font-sans)';
  const mono = 'var(--chat-font-mono)';

  return {
    typeBodyFontFamily: sans,
    typeBodyFontSize: px(r.body.size),
    typeBodyFontWeight: String(r.body.weight),
    typeBodyLineHeight: px(r.body.lineHeight),

    typeBodyBoldFontFamily: sans,
    typeBodyBoldFontSize: px(r['body-bold'].size),
    typeBodyBoldFontWeight: String(r['body-bold'].weight),
    typeBodyBoldLineHeight: px(r['body-bold'].lineHeight),

    typeBodyItalicFontFamily: sans,
    typeBodyItalicFontSize: px(r['body-italic'].size),
    typeBodyItalicFontWeight: String(r['body-italic'].weight),
    typeBodyItalicFontStyle: r['body-italic'].style ?? 'normal',
    typeBodyItalicLineHeight: px(r['body-italic'].lineHeight),

    typeBodyLinkFontFamily: sans,
    typeBodyLinkFontSize: px(r['body-link'].size),
    typeBodyLinkFontWeight: String(r['body-link'].weight),
    typeBodyLinkLineHeight: px(r['body-link'].lineHeight),

    typeH1FontFamily: sans,
    typeH1FontSize: px(r.h1.size),
    typeH1FontWeight: String(r.h1.weight),
    typeH1LineHeight: px(r.h1.lineHeight),

    typeH2FontFamily: sans,
    typeH2FontSize: px(r.h2.size),
    typeH2FontWeight: String(r.h2.weight),
    typeH2LineHeight: px(r.h2.lineHeight),

    typeH3FontFamily: sans,
    typeH3FontSize: px(r.h3.size),
    typeH3FontWeight: String(r.h3.weight),
    typeH3LineHeight: px(r.h3.lineHeight),

    typeInlineCodeFontFamily: mono,
    typeInlineCodeFontSize: px(r['inline-code'].size),
    typeInlineCodeFontWeight: String(r['inline-code'].weight),
    typeInlineCodeLineHeight: px(r['inline-code'].lineHeight),

    typeCodeFontFamily: mono,
    typeCodeFontSize: px(r.code.size),
    typeCodeFontWeight: String(r.code.weight),
    typeCodeLineHeight: px(r.code.lineHeight),

    typeCodeLangFontFamily: sans,
    typeCodeLangFontSize: px(r['code-lang'].size),
    typeCodeLangFontWeight: String(r['code-lang'].weight),
    typeCodeLangLineHeight: px(r['code-lang'].lineHeight),

    typeMentionFontFamily: sans,
    typeMentionFontSize: px(r.mention.size),
    typeMentionFontWeight: String(r.mention.weight),

    icPadX: px(c.inlineCodePadX),
    icPadY: px(c.inlineCodePadY),

    mentionPadX: px(c.mentionPadX),
    mentionPadY: px(c.mentionPadY),
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
    themeVars: toThemeVars(config),
  };
}
