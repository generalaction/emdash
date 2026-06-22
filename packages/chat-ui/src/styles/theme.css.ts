/**
 * theme.css.ts — VE global theme contract + chat-ui default theme.
 *
 * CONTRACT (vars)
 *   createGlobalThemeContract defines the stable public CSS variable names
 *   (--chat-fg, --chat-type-body-font-size, --chat-font-sans, ...) that every
 *   .css.ts file and host override preset depend on.
 *
 * DEFAULT THEME (createGlobalTheme × 2)
 *   The two createGlobalTheme calls are the chat-ui built-in default theme.
 *   Typography metric and chip-pad values are derived from DEFAULT_CONFIG so
 *   this file and the runtime buildChatTheme share the same single source of truth.
 *   Color/radii/family literals are kept inline here (host can override them via
 *   class-selector rules without inline-style specificity issues).
 *   Specificity is zero (:where() selectors) so any host override wins
 *   regardless of stylesheet load order.
 *
 * HOST OVERRIDE (chat-theme.css)
 *   The optional chat-theme.css preset rebinds --chat-font-sans, colors and
 *   radii to the emdash design-system tokens (system sans on desktop). It
 *   inherits everything not explicitly overridden from this default theme.
 */

import { DEFAULT_CONFIG } from '@core/config';
import { createGlobalTheme, createGlobalThemeContract } from '@vanilla-extract/css';

// ── Contract (stable public names) ────────────────────────────────────────────

// The second argument to createGlobalThemeContract is a mapFn that receives
// the leaf value and returns the CSS custom property name.
// We use the value itself as the name suffix so the TS key and CSS name are
// both visible: vars.fg compiles to var(--chat-fg).

export const vars = createGlobalThemeContract(
  {
    // ── Color palette ─────────────────────────────────────────────────────────
    fg: 'chat-fg',
    fgBody: 'chat-fg-body',
    fgMuted: 'chat-fg-muted',
    fgPassive: 'chat-fg-passive',
    bg: 'chat-bg',
    bg1: 'chat-bg-1',
    bg2: 'chat-bg-2',
    bg3: 'chat-bg-3',
    border: 'chat-border',

    // User message card surface
    userCardBg: 'chat-user-card-bg',
    userCardBorder: 'chat-user-card-border',
    userCardBorderHover: 'chat-user-card-border-hover',

    // Resolved context-mention pill
    mentionChipBg: 'chat-mention-chip-bg',
    mentionChipFg: 'chat-mention-chip-fg',
    mentionChipRing: 'chat-mention-chip-ring',

    // Diff surface
    diffAdded: 'chat-diff-added',
    diffDeleted: 'chat-diff-deleted',
    diffModified: 'chat-diff-modified',

    // Misc semantic
    link: 'chat-link',
    bubbleUser: 'chat-bubble-user',
    bubbleUserFg: 'chat-bubble-user-fg',
    mentionBg: 'chat-mention-bg',
    mentionFg: 'chat-mention-fg',
    codeBg: 'chat-code-bg',
    codeInlineBg: 'chat-code-inline-bg',
    tableHeaderBg: 'chat-table-header-bg',
    planDone: 'chat-plan-done',
    planActive: 'chat-plan-active',

    // ── Non-color design tokens ────────────────────────────────────────────────
    fontSans: 'chat-font-sans',
    fontMono: 'chat-font-mono',
    radiusSm: 'chat-radius-sm',
    radiusMd: 'chat-radius-md',
    radiusLg: 'chat-radius-lg',
    radiusXl: 'chat-radius-xl',
    radiusFull: 'chat-radius-full',

    // ── Private typography (--chat-type-*) ────────────────────────────────────
    // These names must NOT change — prose.css.ts / diff.css.ts reference them
    // and any rename breaks the measure === offsetHeight invariant.
    typeBodyFontFamily: 'chat-type-body-font-family',
    typeBodyFontSize: 'chat-type-body-font-size',
    typeBodyFontWeight: 'chat-type-body-font-weight',
    typeBodyLineHeight: 'chat-type-body-line-height',

    typeBodyBoldFontFamily: 'chat-type-body-bold-font-family',
    typeBodyBoldFontSize: 'chat-type-body-bold-font-size',
    typeBodyBoldFontWeight: 'chat-type-body-bold-font-weight',
    typeBodyBoldLineHeight: 'chat-type-body-bold-line-height',

    typeBodyItalicFontFamily: 'chat-type-body-italic-font-family',
    typeBodyItalicFontSize: 'chat-type-body-italic-font-size',
    typeBodyItalicFontWeight: 'chat-type-body-italic-font-weight',
    typeBodyItalicFontStyle: 'chat-type-body-italic-font-style',
    typeBodyItalicLineHeight: 'chat-type-body-italic-line-height',

    typeBodyLinkFontFamily: 'chat-type-body-link-font-family',
    typeBodyLinkFontSize: 'chat-type-body-link-font-size',
    typeBodyLinkFontWeight: 'chat-type-body-link-font-weight',
    typeBodyLinkLineHeight: 'chat-type-body-link-line-height',

    typeH1FontFamily: 'chat-type-h1-font-family',
    typeH1FontSize: 'chat-type-h1-font-size',
    typeH1FontWeight: 'chat-type-h1-font-weight',
    typeH1LineHeight: 'chat-type-h1-line-height',

    typeH2FontFamily: 'chat-type-h2-font-family',
    typeH2FontSize: 'chat-type-h2-font-size',
    typeH2FontWeight: 'chat-type-h2-font-weight',
    typeH2LineHeight: 'chat-type-h2-line-height',

    typeH3FontFamily: 'chat-type-h3-font-family',
    typeH3FontSize: 'chat-type-h3-font-size',
    typeH3FontWeight: 'chat-type-h3-font-weight',
    typeH3LineHeight: 'chat-type-h3-line-height',

    typeInlineCodeFontFamily: 'chat-type-inline-code-font-family',
    typeInlineCodeFontSize: 'chat-type-inline-code-font-size',
    typeInlineCodeFontWeight: 'chat-type-inline-code-font-weight',
    typeInlineCodeLineHeight: 'chat-type-inline-code-line-height',

    typeCodeFontFamily: 'chat-type-code-font-family',
    typeCodeFontSize: 'chat-type-code-font-size',
    typeCodeFontWeight: 'chat-type-code-font-weight',
    typeCodeLineHeight: 'chat-type-code-line-height',

    typeCodeLangFontFamily: 'chat-type-code-lang-font-family',
    typeCodeLangFontSize: 'chat-type-code-lang-font-size',
    typeCodeLangFontWeight: 'chat-type-code-lang-font-weight',
    typeCodeLangLineHeight: 'chat-type-code-lang-line-height',

    // Mention chip — family only (size/weight baked as literals in prose.css.ts
    // to prevent host override, matching the comment in the old tokens.css).
    typeMentionFontFamily: 'chat-type-mention-font-family',

    // ── Density (runtime-settable by ChatRoot) ─────────────────────────────────
    icPadX: 'chat-ic-pad-x',
    icPadY: 'chat-ic-pad-y',
  },
  (value) => `--${value}`
);

// ── Helpers ────────────────────────────────────────────────────────────────────

// CSS font-family values — family follows the host --font-sans / --chat-font-mono
// just like the old tokens.css, so host custom fonts apply here too.
const SANS_VAR = vars.fontSans;
const MONO_VAR = vars.fontMono;

function pxStr(n: number) {
  return `${n}px`;
}

// Derive typography + chip values from DEFAULT_CONFIG (shared source of truth
// with buildChatTheme / toCssVars so build-time defaults and runtime emission
// can never drift from each other).
const r = DEFAULT_CONFIG.roles;
const c = DEFAULT_CONFIG.chips;

// ── Light theme ────────────────────────────────────────────────────────────────
// Selector mirrors the old :where(:root), :where(.emlight) block exactly.

createGlobalTheme(':where(:root), :where(.emlight)', vars, {
  // Colors
  fg: '#21201f',
  fgBody: 'color-mix(in srgb, #616060 40%, #21201f)',
  fgMuted: '#616060',
  fgPassive: '#8e8d8d',
  bg: '#fcfcfc',
  bg1: '#f1f0f0',
  bg2: '#e5e4e4',
  bg3: '#dadada',
  border: '#c5c4c4',
  userCardBg: '#f1f0f0',
  userCardBorder: '#c5c4c4',
  userCardBorderHover: '#b3b2b2',
  mentionChipBg: '#e7e6e6',
  mentionChipFg: '#21201f',
  mentionChipRing: 'rgba(0, 0, 0, 0.1)',
  diffAdded: '#4f9f4f',
  diffDeleted: '#d56761',
  diffModified: '#c28c00',

  link: '#2263a4',
  bubbleUser: '#dadada',
  bubbleUserFg: '#21201f',
  mentionBg: '#dbeafe',
  mentionFg: '#1d4ed8',
  codeBg: '#fcfcfc',
  codeInlineBg: 'rgba(0, 0, 0, 0.06)',
  tableHeaderBg: '#f1f0f0',
  planDone: '#22c55e',
  planActive: '#f59e0b',

  // Non-color tokens
  fontSans: ['Inter Variable', 'sans-serif'].join(', '),
  fontMono: "'JetBrains Mono Variable', 'JetBrains Mono', Menlo, Monaco, monospace",
  radiusSm: '0.375rem',
  radiusMd: '0.5rem',
  radiusLg: '0.625rem',
  radiusXl: '0.875rem',
  radiusFull: '9999px',

  // Typography — derived from DEFAULT_CONFIG.roles so values always match the
  // runtime buildChatTheme output and the measure===offsetHeight invariant holds.
  typeBodyFontFamily: SANS_VAR,
  typeBodyFontSize: pxStr(r.body.size),
  typeBodyFontWeight: String(r.body.weight),
  typeBodyLineHeight: pxStr(r.body.lineHeight),

  typeBodyBoldFontFamily: SANS_VAR,
  typeBodyBoldFontSize: pxStr(r['body-bold'].size),
  typeBodyBoldFontWeight: String(r['body-bold'].weight),
  typeBodyBoldLineHeight: pxStr(r['body-bold'].lineHeight),

  typeBodyItalicFontFamily: SANS_VAR,
  typeBodyItalicFontSize: pxStr(r['body-italic'].size),
  typeBodyItalicFontWeight: String(r['body-italic'].weight),
  typeBodyItalicFontStyle: r['body-italic'].style ?? 'normal',
  typeBodyItalicLineHeight: pxStr(r['body-italic'].lineHeight),

  typeBodyLinkFontFamily: SANS_VAR,
  typeBodyLinkFontSize: pxStr(r['body-link'].size),
  typeBodyLinkFontWeight: String(r['body-link'].weight),
  typeBodyLinkLineHeight: pxStr(r['body-link'].lineHeight),

  typeH1FontFamily: SANS_VAR,
  typeH1FontSize: pxStr(r.h1.size),
  typeH1FontWeight: String(r.h1.weight),
  typeH1LineHeight: pxStr(r.h1.lineHeight),

  typeH2FontFamily: SANS_VAR,
  typeH2FontSize: pxStr(r.h2.size),
  typeH2FontWeight: String(r.h2.weight),
  typeH2LineHeight: pxStr(r.h2.lineHeight),

  typeH3FontFamily: SANS_VAR,
  typeH3FontSize: pxStr(r.h3.size),
  typeH3FontWeight: String(r.h3.weight),
  typeH3LineHeight: pxStr(r.h3.lineHeight),

  typeInlineCodeFontFamily: MONO_VAR,
  typeInlineCodeFontSize: pxStr(r['inline-code'].size),
  typeInlineCodeFontWeight: String(r['inline-code'].weight),
  typeInlineCodeLineHeight: pxStr(r['inline-code'].lineHeight),

  typeCodeFontFamily: MONO_VAR,
  typeCodeFontSize: pxStr(r.code.size),
  typeCodeFontWeight: String(r.code.weight),
  typeCodeLineHeight: pxStr(r.code.lineHeight),

  typeCodeLangFontFamily: SANS_VAR,
  typeCodeLangFontSize: pxStr(r['code-lang'].size),
  typeCodeLangFontWeight: String(r['code-lang'].weight),
  typeCodeLangLineHeight: pxStr(r['code-lang'].lineHeight),

  typeMentionFontFamily: SANS_VAR,

  // Chip padding — derived from DEFAULT_CONFIG.chips
  icPadX: pxStr(c.inlineCodePadX),
  icPadY: pxStr(c.inlineCodePadY),
});

// ── Dark theme ─────────────────────────────────────────────────────────────────
// Only color overrides — typography and chip geometry are identical in both
// themes so there is no need to repeat them here.

createGlobalTheme(':where(.emdark)', vars, {
  // Colors
  fg: '#e9e8e9',
  fgBody: 'color-mix(in srgb, #b8b7b8 40%, #e9e8e9)',
  fgMuted: '#b8b7b8',
  fgPassive: '#929091',
  bg: '#111111',
  bg1: '#181818',
  bg2: '#202020',
  bg3: '#282727',
  border: '#373636',
  userCardBg: '#181818',
  userCardBorder: '#373636',
  userCardBorderHover: '#525050',
  mentionChipBg: '#2a2929',
  mentionChipFg: '#e6e6e6',
  mentionChipRing: 'rgba(255, 255, 255, 0.1)',
  diffAdded: '#54a55a',
  diffDeleted: '#dc6b67',
  diffModified: '#ce981d',

  link: '#7cbcff',
  bubbleUser: '#282727',
  bubbleUserFg: '#e9e8e9',
  mentionBg: '#1a293a',
  mentionFg: '#7cbcff',
  codeBg: '#111111',
  codeInlineBg: 'rgba(255, 255, 255, 0.08)',
  tableHeaderBg: '#181818',
  planDone: '#4fcca8',
  planActive: '#dead52',

  // Non-color tokens (same as light — host overrides these if needed)
  fontSans: ['Inter Variable', 'sans-serif'].join(', '),
  fontMono: "'JetBrains Mono Variable', 'JetBrains Mono', Menlo, Monaco, monospace",
  radiusSm: '0.375rem',
  radiusMd: '0.5rem',
  radiusLg: '0.625rem',
  radiusXl: '0.875rem',
  radiusFull: '9999px',

  // Typography — same values as light (font metrics are theme-independent).
  typeBodyFontFamily: SANS_VAR,
  typeBodyFontSize: pxStr(r.body.size),
  typeBodyFontWeight: String(r.body.weight),
  typeBodyLineHeight: pxStr(r.body.lineHeight),

  typeBodyBoldFontFamily: SANS_VAR,
  typeBodyBoldFontSize: pxStr(r['body-bold'].size),
  typeBodyBoldFontWeight: String(r['body-bold'].weight),
  typeBodyBoldLineHeight: pxStr(r['body-bold'].lineHeight),

  typeBodyItalicFontFamily: SANS_VAR,
  typeBodyItalicFontSize: pxStr(r['body-italic'].size),
  typeBodyItalicFontWeight: String(r['body-italic'].weight),
  typeBodyItalicFontStyle: r['body-italic'].style ?? 'normal',
  typeBodyItalicLineHeight: pxStr(r['body-italic'].lineHeight),

  typeBodyLinkFontFamily: SANS_VAR,
  typeBodyLinkFontSize: pxStr(r['body-link'].size),
  typeBodyLinkFontWeight: String(r['body-link'].weight),
  typeBodyLinkLineHeight: pxStr(r['body-link'].lineHeight),

  typeH1FontFamily: SANS_VAR,
  typeH1FontSize: pxStr(r.h1.size),
  typeH1FontWeight: String(r.h1.weight),
  typeH1LineHeight: pxStr(r.h1.lineHeight),

  typeH2FontFamily: SANS_VAR,
  typeH2FontSize: pxStr(r.h2.size),
  typeH2FontWeight: String(r.h2.weight),
  typeH2LineHeight: pxStr(r.h2.lineHeight),

  typeH3FontFamily: SANS_VAR,
  typeH3FontSize: pxStr(r.h3.size),
  typeH3FontWeight: String(r.h3.weight),
  typeH3LineHeight: pxStr(r.h3.lineHeight),

  typeInlineCodeFontFamily: MONO_VAR,
  typeInlineCodeFontSize: pxStr(r['inline-code'].size),
  typeInlineCodeFontWeight: String(r['inline-code'].weight),
  typeInlineCodeLineHeight: pxStr(r['inline-code'].lineHeight),

  typeCodeFontFamily: MONO_VAR,
  typeCodeFontSize: pxStr(r.code.size),
  typeCodeFontWeight: String(r.code.weight),
  typeCodeLineHeight: pxStr(r.code.lineHeight),

  typeCodeLangFontFamily: SANS_VAR,
  typeCodeLangFontSize: pxStr(r['code-lang'].size),
  typeCodeLangFontWeight: String(r['code-lang'].weight),
  typeCodeLangLineHeight: pxStr(r['code-lang'].lineHeight),

  typeMentionFontFamily: SANS_VAR,

  // Chip padding
  icPadX: pxStr(c.inlineCodePadX),
  icPadY: pxStr(c.inlineCodePadY),
});
