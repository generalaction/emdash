/**
 * Block-model types produced by parseBlocks().
 *
 * A ChatMessage's markdown is split into Block[]  so that:
 *   1. HeightModel can measure each block independently.
 *   2. Renderers can specialise per-tier (prose / code / island).
 *   3. Collapse state is stored per-block by stable ID.
 */

/** Coarse rendering tier – controls measurement strategy. */
export type BlockTier = 'prose' | 'code' | 'island';

/** Fine-grained variant within the prose tier. */
export type ProseVariant = 'body' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'list-item' | 'quote';

/** Types of rich "island" blocks rendered via slots. */
export type IslandType = 'table' | 'math' | 'mermaid' | 'image' | 'rule';

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

export type InlineRun = InlineText | InlineCode | InlineMention;

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
 * A rich "island" block rendered entirely through a slot.
 * Height uses a fixed constant or is measured once via DOM.
 */
export type IslandBlock = {
  kind: 'island';
  tier: 'island';
  id: BlockId;
  islandType: IslandType;
  /** Raw source (markdown table, math expression, mermaid definition, URL, or '-'). */
  raw: string;
};

export type Block = ProseBlock | CodeBlock | IslandBlock;
