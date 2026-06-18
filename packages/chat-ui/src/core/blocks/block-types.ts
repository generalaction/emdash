/**
 * Block-model types produced by parseMarkdownToBlocks().
 *
 * A ChatMessage's markdown is split into Block[]  so that:
 *   1. HeightModel can measure each block independently.
 *   2. Renderers can specialise per-tier (prose / code / table).
 *   3. Collapse state is stored per-block by stable ID.
 */

/** Coarse rendering tier – controls measurement strategy. */
export type BlockTier = 'prose' | 'code' | 'table';

/** Fine-grained variant within the prose tier. */
export type ProseVariant = 'body' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'list-item' | 'quote';

// ── Inline run types ──────────────────────────────────────────────────────────

/** A segment of styled text within a prose block. */
export type InlineText = {
  kind: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  href?: string;
};

/** Inline code span — rendered with extra chrome (padding). */
export type InlineCode = {
  kind: 'code';
  text: string;
};

/** Mention chip — rendered with badge-style chrome (padding + bg). */
export type InlineMention = {
  kind: 'mention';
  label: string;
  /** Optional semantic tone for the chip colour. */
  tone?: string;
};

/**
 * Explicit line break — produced from a hard break node (two trailing spaces /
 * backslash line ending) or a literal `\n` inside a text node. `layoutProse`
 * uses these as segment boundaries; `runsToRichItems` never sees them.
 */
export type InlineBreak = { kind: 'break' };

export type InlineRun = InlineText | InlineCode | InlineMention | InlineBreak;

// ── Block types ───────────────────────────────────────────────────────────────

/** Stable ID format: `${messageId}#${blockIndex}` */
export type BlockId = string;

/**
 * A prose block (paragraph, heading, list item, or blockquote paragraph).
 * The `runs` array is what pretext/rich-inline receives for height measurement.
 */
export type ProseBlock = {
  kind: 'prose';
  tier: 'prose';
  id: BlockId;
  variant: ProseVariant;
  runs: InlineRun[];
  /** Nesting depth (for list items and blockquotes). */
  depth?: number;
};

/**
 * A fenced or indented code block.
 * Height is computed via: `lines.length * CODE_LINE_HEIGHT + 2 * CODE_BLOCK_PAD_Y`.
 */
export type CodeBlock = {
  kind: 'code';
  tier: 'code';
  id: BlockId;
  /** Raw source code. */
  code: string;
  /** Optional language hint (e.g. "typescript"). */
  lang?: string;
};

/**
 * A markdown table — formula-measured (static row height), no DOM write-back.
 * Height = (1 + rows.length) * TABLE_ROW_H + TABLE_BORDER.
 */
export type TableBlock = {
  kind: 'table';
  tier: 'table';
  id: BlockId;
  /** Column header labels. */
  header: string[];
  /** Data rows — each row is an array of cell strings, same length as header. */
  rows: string[][];
};

export type Block = ProseBlock | CodeBlock | TableBlock;
