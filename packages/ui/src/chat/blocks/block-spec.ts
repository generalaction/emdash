/**
 * BlockSpec<T> — colocates measure + render for each block tier.
 *
 * This is the key abstraction that prevents HeightModel and the renderer from
 * drifting apart: each spec owns both the pixel-height formula and the React
 * output for the same block type.  Changing the rendering MUST update measure
 * (and vice versa) because they live in the same file.
 */

import type React from 'react';
import type { FontConfig } from '../measure/fonts';
import type { ChatSlots } from '../view/chat-transcript';
import type { Block, CodeBlock, IslandBlock, ProseBlock } from './block-types';

// ── Context types ─────────────────────────────────────────────────────────────

export type BlockMeasureCtx = {
  /** Available width in px (content area inside the bubble). */
  width: number;
  fonts: FontConfig;
  /** Whether this block is collapsed (collapsed → height 0). */
  collapsed: boolean;
  /** DOM-measured height for islands (written back via setMeasured). */
  measured?: number;
};

export type BlockRenderCtx = {
  slots?: ChatSlots;
  collapsed: boolean;
  /** Called with (blockId, pixelHeight) once the island's element is mounted. */
  onMeasured?: (blockId: string, height: number) => void;
  /**
   * When true the virtualizer is actively scrolling. Code and island blocks
   * should render a cheap height-preserving placeholder instead of the full
   * DOM tree so per-frame React work is reduced.  Prose always renders in full
   * to keep text visible and text reflow working during scroll.
   */
  isScrolling?: boolean;
};

// ── Spec interface ────────────────────────────────────────────────────────────

export interface BlockSpec<T extends Block> {
  /**
   * Content height of this block in pixels, including all internal chrome
   * (padding, borders, lang label, etc.) but NOT the inter-block flex gap.
   * Returns 0 when `ctx.collapsed` is true.
   */
  measure(block: T, ctx: BlockMeasureCtx): number;

  /** React output for this block. Must produce exactly the height reported by measure(). */
  render(block: T, ctx: BlockRenderCtx): React.ReactNode;
}

// ── Registry ──────────────────────────────────────────────────────────────────

import { codeSpec } from './specs/code-spec';
import { islandSpec } from './specs/island-spec';
import { proseSpec } from './specs/prose-spec';

/** Return the spec for a block by its tier. */
export function specForBlock(block: Block): BlockSpec<Block> {
  switch (block.tier) {
    case 'prose':
      return proseSpec as BlockSpec<Block>;
    case 'code':
      return codeSpec as BlockSpec<Block>;
    case 'island':
      return islandSpec as BlockSpec<Block>;
  }
}

export { proseSpec, codeSpec, islandSpec };
export type { ProseBlock, CodeBlock, IslandBlock };
