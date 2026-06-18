/**
 * block-stack — per-child memoized block layout + compose tree builder.
 *
 * Two-level cache hierarchy
 * ─────────────────────────
 * Level 1 (Row.tsx nodeMemo):  WeakMap keyed by the ChatItem object.
 *   Skips the whole row re-measure for committed (non-streaming) rows
 *   when theme.version + width + expanded are unchanged.
 *
 * Level 2 (blockMemo here):  WeakMap keyed by the Block object.
 *   Skips individual block re-measures inside streaming rows.  Since
 *   parseMarkdownToBlocksCached reuses the same Block object references
 *   for unchanged content, only the last (growing) block is a cache miss
 *   each tick — the earlier blocks are hits.
 *
 * Fingerprint: `${theme.version}|${width}|${isCollapsed(block.id)}`
 * Collapsed blocks are zero-height placeholders; their fingerprint includes
 * the isCollapsed flag so they remeasure when uncollapsed.
 *
 * layoutBlockStack
 * ─────────────────
 * Replaces `layoutBlocks` from `components/rich-text/layout.ts`.
 * Returns a `Measured<StackLayout>` (compose tree node) instead of a
 * bespoke `BlocksLayout` object.  Each placed child's `Measured.layout`
 * is a `BlockLeafLayout` (ProseLaidOut / CodeLaidOut / TableLaidOut extended
 * with a `raw` back-reference) so `renderBlockLeaf` in Project.tsx can render
 * it without a separate block lookup.
 */

import type { Block, CodeBlock, ProseBlock, TableBlock } from '../blocks/block-types';
import type { Measured, MeasureCtx } from '../define';
import { stack } from '../compose';
import type { StackLayout } from '../compose';
import { layoutCode } from '../../components/code/layout';
import { layoutProse } from '../../components/prose/layout';
import { layoutTable } from '../../components/table/layout';
import type {
  CodeLaidOut,
  ProseLaidOut,
  TableLaidOut,
} from './layout-types';
import type { BlockLeafLayout } from '../../components/Project';

// ── Per-block memo ────────────────────────────────────────────────────────────

const blockMemo = new WeakMap<Block, { fingerprint: string; result: Measured<BlockLeafLayout> }>();

function measureBlockCached(block: Block, ctx: MeasureCtx): Measured<BlockLeafLayout> {
  const fingerprint = `${ctx.theme.version}|${ctx.width}|${ctx.isCollapsed(block.id)}`;
  const cached = blockMemo.get(block);
  if (cached?.fingerprint === fingerprint) return cached.result;

  let result: Measured<BlockLeafLayout>;

  switch (block.tier) {
    case 'prose': {
      const laid: ProseLaidOut = layoutProse(block as ProseBlock, ctx.width, ctx.theme.fonts, 0);
      const layout: BlockLeafLayout = { ...(laid as ProseLaidOut & { kind: 'prose' }), raw: block as ProseBlock };
      result = { height: laid.height, width: laid.contentWidth, layout };
      break;
    }
    case 'code': {
      const laid: CodeLaidOut = layoutCode(block as CodeBlock, ctx.theme.fonts, 0, ctx.width);
      const layout: BlockLeafLayout = { ...(laid as CodeLaidOut & { kind: 'code' }), raw: block as CodeBlock };
      result = { height: laid.height, width: laid.contentWidth, layout };
      break;
    }
    case 'table': {
      const laid: TableLaidOut = layoutTable(block as TableBlock, 0, ctx.width);
      const layout: BlockLeafLayout = { ...(laid as TableLaidOut & { kind: 'table' }), raw: block };
      result = { height: laid.height, width: laid.contentWidth, layout };
      break;
    }
  }

  blockMemo.set(block, { fingerprint, result });
  return result;
}

// ── layoutBlockStack ─────────────────────────────────────────────────────────

export type BlockStackOpts = {
  /** Symmetric vertical padding (px) applied around the entire stack. */
  padY?: number;
  /** Gap between consecutive blocks of different tiers (or default gap). */
  blockGap?: number;
  /** Tighter gap when both the previous and current visible block are prose. */
  proseGap?: number;
  /** Optional collapse guard; collapsed blocks are skipped (height 0). */
  isCollapsed?: (id: string) => boolean;
};

/**
 * Lay out an ordered array of blocks into a compose `Measured<StackLayout>`.
 *
 * Each visible block is measured through `measureBlockCached` and given an `id`
 * matching its `block.id` so the enclosing `stack` places it correctly.
 * Collapsed blocks contribute a zero-height entry so the block-array indices
 * remain stable.
 *
 * This is the compose-tree replacement for `layoutBlocks` in
 * `components/rich-text/layout.ts`.
 */
export function layoutBlockStack(
  blocks: Block[],
  ctx: MeasureCtx,
  opts: BlockStackOpts = {}
): Measured<StackLayout> {
  const { padY = 0, blockGap = 0, proseGap, isCollapsed = () => false } = opts;

  const children: { id: string; measured: Measured<BlockLeafLayout> }[] = [];
  let visibleCount = 0;

  for (const block of blocks) {
    if (isCollapsed(block.id)) {
      // Zero-height placeholder — keeps block IDs stable but contributes no height.
      const zeroMeasured: Measured<BlockLeafLayout> = {
        height: 0,
        width: 0,
        layout: (() => {
          // Return a minimal typed placeholder matching the block's tier.
          if (block.tier === 'prose') {
            const l: BlockLeafLayout = {
              kind: 'prose',
              id: block.id,
              top: 0,
              height: 0,
              contentWidth: 0,
              lineHeight: 0,
              lines: [],
              raw: block as ProseBlock,
            };
            return l;
          }
          if (block.tier === 'code') {
            const l: BlockLeafLayout = {
              kind: 'code',
              id: block.id,
              top: 0,
              height: 0,
              contentWidth: 0,
              lines: [],
              raw: block as CodeBlock,
            };
            return l;
          }
          const l: BlockLeafLayout = {
            kind: 'table',
            id: block.id,
            top: 0,
            height: 0,
            contentWidth: 0,
            colWidths: [],
            tableWidth: 0,
            header: (block as TableBlock).header,
            rows: (block as TableBlock).rows,
            raw: block,
          };
          return l;
        })(),
      };
      children.push({ id: block.id, measured: zeroMeasured });
      continue;
    }

    const measured = measureBlockCached(block, ctx);

    // Gap is applied via the stack combinator's per-slot gap function.
    // We track tiers here so we can pass a per-index gap to `stack`.
    // Because `stack` takes a gap function by index, we store tier sequence
    // alongside children so the gap function can inspect previous tier.
    children.push({ id: block.id, measured });
    visibleCount++;
  }

  // Build the tier sequence for gap computation (excluding collapsed/zero entries).
  const visibleTiers: Array<Block['tier'] | null> = [];
  for (const block of blocks) {
    if (!isCollapsed(block.id)) visibleTiers.push(block.tier);
  }

  // Gap function: receives visible-index i (≥ 1) and returns gap before child[i].
  // We need to map the children array index to the visible sequence.
  // Since collapsed blocks are in `children` too (zero-height), build a mapping.
  const tiers: Array<Block['tier'] | null> = blocks.map((b) =>
    isCollapsed(b.id) ? null : b.tier
  );

  const gapFn = (idx: number): number => {
    // idx is the index in `children` (includes collapsed). Find prev visible tier.
    let prevVisible: Block['tier'] | null = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (tiers[j] !== null) {
        prevVisible = tiers[j];
        break;
      }
    }
    const curTier = tiers[idx];
    if (prevVisible === null || curTier === null) return 0;
    if (proseGap !== undefined && prevVisible === 'prose' && curTier === 'prose') return proseGap;
    return blockGap;
  };

  // Only apply gap between non-collapsed items; collapsed ones have height 0
  // so gap before them would still be added. Use gap 0 before collapsed.
  const safegapFn = (idx: number): number => {
    if (tiers[idx] === null) return 0;
    return gapFn(idx);
  };

  return stack(children, { padY, gap: visibleCount > 1 ? safegapFn : 0 });
}
