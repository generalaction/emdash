/**
 * tokens.ts — single TypeScript source of truth for all measurement-coupled
 * design tokens in chat-ui.
 *
 * Feeds:
 *   - styles/theme.css.ts (VE global theme contract → CSS variables)
 *   - core/measure/default-typography.ts (re-exports typography from here)
 *   - core/metrics.ts (derives font shorthands + geometry constants)
 *
 * Values must be kept in sync with @emdash/ui/theme/tokens.js type.* entries.
 * With this file in place the hand-mirrored --chat-type-* CSS block is generated,
 * so drift between CSS and JS measurement is a compile error, not a runtime bug.
 */

// ── Font family stacks ────────────────────────────────────────────────────────

export const SANS_STACK = ['Inter Variable', 'sans-serif'] as const;
export const MONO_STACK = [
  'JetBrains Mono Variable',
  'JetBrains Mono',
  'Menlo',
  'Monaco',
  'monospace',
] as const;

// CSS font-family string representations (used in VE + pretext).
export const SANS_FAMILY_CSS = SANS_STACK.join(', ');
export const MONO_FAMILY_CSS = MONO_STACK.join(', ');

// ── Typography scale ──────────────────────────────────────────────────────────

export type TypeRole = {
  fontFamily: 'sans' | 'mono';
  /** px */
  fontSize: number;
  fontWeight: number;
  /** px */
  lineHeight: number;
  fontStyle?: 'italic';
};

export const TYPE_ROLES = {
  body: { fontFamily: 'sans', fontSize: 14, fontWeight: 400, lineHeight: 20 },
  'body-bold': { fontFamily: 'sans', fontSize: 14, fontWeight: 600, lineHeight: 20 },
  'body-italic': {
    fontFamily: 'sans',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  'body-link': { fontFamily: 'sans', fontSize: 14, fontWeight: 400, lineHeight: 20 },
  h1: { fontFamily: 'sans', fontSize: 20, fontWeight: 600, lineHeight: 28 },
  h2: { fontFamily: 'sans', fontSize: 17, fontWeight: 600, lineHeight: 25 },
  h3: { fontFamily: 'sans', fontSize: 14, fontWeight: 600, lineHeight: 22 },
  'inline-code': { fontFamily: 'mono', fontSize: 12, fontWeight: 400, lineHeight: 20 },
  mention: { fontFamily: 'sans', fontSize: 12, fontWeight: 500, lineHeight: 20 },
  code: { fontFamily: 'mono', fontSize: 13, fontWeight: 400, lineHeight: 20 },
  'code-lang': { fontFamily: 'sans', fontSize: 11, fontWeight: 500, lineHeight: 16 },
} as const satisfies Record<string, TypeRole>;

/** Resolve the CSS font-family string for a role. */
export function roleFamilyCss(role: TypeRole): string {
  return role.fontFamily === 'mono' ? MONO_FAMILY_CSS : SANS_FAMILY_CSS;
}

// ── Chip / inline-chrome geometry ─────────────────────────────────────────────

/**
 * Default density for inline chips.
 * These match `buildTheme()` defaults in core/theme.ts and the
 * CSS variable defaults in styles/theme.css.ts.
 */
export const CHIP_DEFAULTS = {
  /** Horizontal padding inside the inline-code chip (px). Runtime-settable via --chat-ic-pad-x. */
  inlineCodePadX: 6,
  /** Vertical padding inside the inline-code chip (px). Runtime-settable via --chat-ic-pad-y. */
  inlineCodePadY: 2,
  /** Width reserved for the resolved-mention icon (px). */
  mentionIconW: 14,
  /** Gap between mention icon and mention label text (px). */
  mentionIconGap: 4,
  /** Horizontal padding inside the mention chip (px). */
  mentionPadX: 4,
  /** Vertical padding inside the mention chip (px). */
  mentionPadY: 2,
} as const;

// ── Derived extras ────────────────────────────────────────────────────────────

/** Total extra horizontal space consumed by an inline-code chip (2 × padX). */
export const INLINE_CODE_EXTRA_WIDTH = 2 * CHIP_DEFAULTS.inlineCodePadX;

/** Total extra horizontal space consumed by a plain mention chip (2 × padX). */
export const MENTION_EXTRA_WIDTH = 2 * CHIP_DEFAULTS.mentionPadX;
