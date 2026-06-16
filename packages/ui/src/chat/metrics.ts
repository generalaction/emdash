/**
 * ChatMetrics — single source of truth for all chat renderer metrics.
 *
 * These values drive BOTH measurement (HeightModel) and rendering (chat.css via CSS variables).
 * Because chat.css consumes `var(--chat-*)` produced by `metricsToCssVars()`, measure and render
 * always use the exact same numbers — drift is structurally impossible.
 *
 * Font families are set here as named fonts (bundled via @fontsource-variable). Pretext requires
 * named fonts for accurate glyph-width measurement on macOS.
 */

// ── Font families ────────────────────────────────────────────────────────────

export const SANS_FAMILY = '"Inter Variable", sans-serif';
export const MONO_FAMILY = '"Cascadia Code", ui-monospace, monospace';

// ── Per-variant typography ───────────────────────────────────────────────────

export type VariantTypography = {
  fontSize: number; // px
  fontWeight: number;
  fontStyle?: 'italic';
  lineHeight: number; // px
};

// Body text
export const BODY: VariantTypography = { fontSize: 14, fontWeight: 400, lineHeight: 22 };
export const BODY_BOLD: VariantTypography = { fontSize: 14, fontWeight: 700, lineHeight: 22 };
export const BODY_ITALIC: VariantTypography = {
  fontSize: 14,
  fontWeight: 400,
  fontStyle: 'italic',
  lineHeight: 22,
};
export const BODY_BOLD_ITALIC: VariantTypography = {
  fontSize: 14,
  fontWeight: 700,
  fontStyle: 'italic',
  lineHeight: 22,
};
export const BODY_LINK: VariantTypography = { fontSize: 14, fontWeight: 500, lineHeight: 22 };

// Headings
export const H1: VariantTypography = { fontSize: 20, fontWeight: 700, lineHeight: 28 };
export const H2: VariantTypography = { fontSize: 17, fontWeight: 700, lineHeight: 25 };
export const H3: VariantTypography = { fontSize: 14, fontWeight: 600, lineHeight: 22 }; // h3–h6

// Inline elements
export const INLINE_CODE: VariantTypography = { fontSize: 12, fontWeight: 600, lineHeight: 22 };
export const MENTION: VariantTypography = { fontSize: 12, fontWeight: 700, lineHeight: 22 };

// Code block
export const CODE_BLOCK: VariantTypography = { fontSize: 12, fontWeight: 400, lineHeight: 18 };

// Code lang label (above the pre block) — same family as code, slightly smaller
export const CODE_LANG: VariantTypography = { fontSize: 11, fontWeight: 500, lineHeight: 18 };

// ── Layout constants ─────────────────────────────────────────────────────────

/** Vertical gap between blocks inside a bubble (flex-gap replaces margin-bottom). */
export const BLOCK_GAP = 10; // px

/** Vertical padding inside the message bubble. */
export const BUBBLE_PAD_Y = 10; // px
/** Horizontal padding inside the message bubble. */
export const BUBBLE_PAD_X = 14; // px
/** Horizontal padding of each message row from the viewport edge. */
export const MESSAGE_PAD_X = 16; // px
/** Vertical gap between consecutive virtualised rows. */
export const MESSAGE_GAP = 8; // px

// Code block chrome
export const CODE_BLOCK_PAD_Y = 10; // px — top/bottom padding of .chat-code-block
export const CODE_BLOCK_PAD_X = 14; // px — left/right padding
export const CODE_BLOCK_BORDER = 1; // px — border width (top + bottom each)

// Inline chip chrome (the extra width occupied by padding/border around the text)
/** 2 * 6px horizontal padding for .chat-code-inline */
export const INLINE_CODE_EXTRA_WIDTH = 12; // px
/** 2 * 7px horizontal padding for .chat-mention chip */
export const MENTION_EXTRA_WIDTH = 14; // px

// List / blockquote
export const LIST_INDENT = 18; // px — padding-left per depth level
export const BLOCKQUOTE_INDENT = 18; // px — padding-left per depth level

// Islands
/** Fixed height budget for mermaid/image islands before DOM measurement corrects them. */
export const ISLAND_FIXED_HEIGHT = 300; // px

// Bubble max-width as a fraction of container (user messages)
export const USER_BUBBLE_MAX_WIDTH_PCT = 85; // %

// ── Thinking row ─────────────────────────────────────────────────────────────

/** Height of the "Thinking…" / "Thought for Xs" header row. */
export const THINKING_HEADER_H = 28; // px
/** Height of the fixed live-streaming window shown while thinking. */
export const THINKING_WINDOW_H = 72; // px — approx 3 body lines + padding
/** Height of the top-fade gradient that truncates the streaming window. */
export const THINKING_FADE_H = 28; // px
/** Vertical padding around the expanded thinking body. */
export const THINKING_PAD_Y = 8; // px

// ── CSS variable map ─────────────────────────────────────────────────────────

/**
 * Produce a flat `Record<string, string>` of `--chat-*` CSS custom properties
 * derived entirely from the constants above.  Set these as inline style on the
 * `.chat-transcript` root so every `var(--chat-*)` reference in chat.css resolves
 * to the exact same value used in measure calculations.
 */
export function metricsToCssVars(): Record<string, string> {
  return {
    // Font families
    '--chat-sans': SANS_FAMILY,
    '--chat-mono': MONO_FAMILY,

    // Body typography
    '--chat-body-size': `${BODY.fontSize}px`,
    '--chat-body-weight': `${BODY.fontWeight}`,
    '--chat-body-lh': `${BODY.lineHeight}px`,
    '--chat-body-bold-weight': `${BODY_BOLD.fontWeight}`,
    '--chat-body-link-weight': `${BODY_LINK.fontWeight}`,

    // Headings
    '--chat-h1-size': `${H1.fontSize}px`,
    '--chat-h1-weight': `${H1.fontWeight}`,
    '--chat-h1-lh': `${H1.lineHeight}px`,
    '--chat-h2-size': `${H2.fontSize}px`,
    '--chat-h2-weight': `${H2.fontWeight}`,
    '--chat-h2-lh': `${H2.lineHeight}px`,
    '--chat-h3-size': `${H3.fontSize}px`,
    '--chat-h3-weight': `${H3.fontWeight}`,
    '--chat-h3-lh': `${H3.lineHeight}px`,

    // Inline code
    '--chat-ic-size': `${INLINE_CODE.fontSize}px`,
    '--chat-ic-weight': `${INLINE_CODE.fontWeight}`,
    '--chat-ic-pad-x': `6px`, // INLINE_CODE_EXTRA_WIDTH / 2
    '--chat-ic-pad-y': `2px`,

    // Mention chip
    '--chat-mention-size': `${MENTION.fontSize}px`,
    '--chat-mention-weight': `${MENTION.fontWeight}`,
    '--chat-mention-pad-x': `7px`, // MENTION_EXTRA_WIDTH / 2

    // Code block
    '--chat-code-size': `${CODE_BLOCK.fontSize}px`,
    '--chat-code-weight': `${CODE_BLOCK.fontWeight}`,
    '--chat-code-lh': `${CODE_BLOCK.lineHeight}px`,
    '--chat-code-pad-y': `${CODE_BLOCK_PAD_Y}px`,
    '--chat-code-pad-x': `${CODE_BLOCK_PAD_X}px`,
    '--chat-code-border': `${CODE_BLOCK_BORDER}px`,

    // Code lang label
    '--chat-lang-size': `${CODE_LANG.fontSize}px`,
    '--chat-lang-weight': `${CODE_LANG.fontWeight}`,
    '--chat-lang-lh': `${CODE_LANG.lineHeight}px`,

    // Layout
    '--chat-block-gap': `${BLOCK_GAP}px`,
    '--chat-bubble-pad-y': `${BUBBLE_PAD_Y}px`,
    '--chat-bubble-pad-x': `${BUBBLE_PAD_X}px`,
    '--chat-msg-pad-x': `${MESSAGE_PAD_X}px`,
    '--chat-list-indent': `${LIST_INDENT}px`,
    '--chat-quote-indent': `${BLOCKQUOTE_INDENT}px`,
    '--chat-island-max-h': `${ISLAND_FIXED_HEIGHT}px`,

    // User bubble max width
    '--chat-user-max-w': `${USER_BUBBLE_MAX_WIDTH_PCT}%`,

    // Thinking row
    '--chat-think-header-h': `${THINKING_HEADER_H}px`,
    '--chat-think-window-h': `${THINKING_WINDOW_H}px`,
    '--chat-think-fade-h': `${THINKING_FADE_H}px`,
    '--chat-think-pad-y': `${THINKING_PAD_Y}px`,
  };
}

// ── CSS font shorthands ───────────────────────────────────────────────────────

function fontShorthand(v: VariantTypography, family: string): string {
  const style = v.fontStyle ? `${v.fontStyle} ` : '';
  return `${style}${v.fontWeight} ${v.fontSize}px ${family}`;
}

export const BODY_FONT = fontShorthand(BODY, SANS_FAMILY);
export const BODY_BOLD_FONT = fontShorthand(BODY_BOLD, SANS_FAMILY);
export const BODY_ITALIC_FONT = fontShorthand(BODY_ITALIC, SANS_FAMILY);
export const BODY_BOLD_ITALIC_FONT = fontShorthand(BODY_BOLD_ITALIC, SANS_FAMILY);
export const BODY_LINK_FONT = fontShorthand(BODY_LINK, SANS_FAMILY);
export const H1_FONT = fontShorthand(H1, SANS_FAMILY);
export const H2_FONT = fontShorthand(H2, SANS_FAMILY);
export const H3_FONT = fontShorthand(H3, SANS_FAMILY);
export const INLINE_CODE_FONT = fontShorthand(INLINE_CODE, MONO_FAMILY);
export const MENTION_FONT = fontShorthand(MENTION, SANS_FAMILY);
export const CODE_BLOCK_FONT = fontShorthand(CODE_BLOCK, MONO_FAMILY);
