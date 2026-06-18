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
 *   `ctx.caches.parseBlocks` reuses the same Block object references
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

import { layoutCode } from '../../components/code/layout';
import type { BlockLeafLayout } from '../../components/Project';
import { layoutProse } from '../../components/prose/layout';
import { layoutTable } from '../../components/table/layout';
import { stack } from '../compose';
import type { StackLayout } from '../compose';
import type { Measured, MeasureCtx } from '../define';
import type { Block, CodeBlock, ProseBlock, TableBlock } from '../markdown/document';
import type { CodeLaidOut, ProseLaidOut, TableLaidOut } from './layout-types';

// ── Per-block memo ────────────────────────────────────────────────────────────

const blockMemo = new WeakMap<Block, { fingerprint: string; result: Measured<BlockLeafLayout> }>();

function measureBlockCached(block: Block, ctx: MeasureCtx): Measured<BlockLeafLayout> {
  const fingerprint = `${ctx.theme.version}|${ctx.width}|${ctx.isCollapsed(block.id)}`;
  const cached = blockMemo.get(block);
  if (cached?.fingerprint === fingerprint) return cached.result;

  let result: Measured<BlockLeafLayout>;

  switch (block.kind) {
    case 'prose': {
      const laid: ProseLaidOut = layoutProse(
        block as ProseBlock,
        ctx.width,
        ctx.theme.fonts,
        0,
        ctx.caches.prepareRichInline.bind(ctx.caches)
      );
      const layout: BlockLeafLayout = { ...laid, raw: block as ProseBlock };
      result = { height: laid.height, width: laid.contentWidth, layout };
      break;
    }
    case 'code': {
      const laid: CodeLaidOut = layoutCode(block as CodeBlock, ctx.theme.fonts, 0, ctx.width);
      const layout: BlockLeafLayout = { ...laid, raw: block as CodeBlock };
      result = { height: laid.height, width: laid.contentWidth, layout };
      break;
    }
    case 'table': {
      const laid: TableLaidOut = layoutTable(block as TableBlock, 0, ctx.width);
      const layout: BlockLeafLayout = { ...laid, raw: block };
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
  /** Gap between consecutive blocks of different kinds (or default gap). */
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
          // Return a minimal typed placeholder matching the block's kind.
          if (block.kind === 'prose') {
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
          if (block.kind === 'code') {
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

  // Build the kind sequence for gap computation (excluding collapsed/zero entries).
  const visibleKinds: Array<Block['kind'] | null> = [];
  for (const block of blocks) {
    if (!isCollapsed(block.id)) visibleKinds.push(block.kind);
  }

  // Gap function: receives visible-index i (≥ 1) and returns gap before child[i].
  // We need to map the children array index to the visible sequence.
  // Since collapsed blocks are in `children` too (zero-height), build a mapping.
  const kinds: Array<Block['kind'] | null> = blocks.map((b) => (isCollapsed(b.id) ? null : b.kind));

  const gapFn = (idx: number): number => {
    // idx is the index in `children` (includes collapsed). Find prev visible kind.
    let prevVisible: Block['kind'] | null = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (kinds[j] !== null) {
        prevVisible = kinds[j];
        break;
      }
    }
    const curKind = kinds[idx];
    if (prevVisible === null || curKind === null) return 0;
    if (proseGap !== undefined && prevVisible === 'prose' && curKind === 'prose') return proseGap;
    return blockGap;
  };

  // Only apply gap between non-collapsed items; collapsed ones have height 0
  // so gap before them would still be added. Use gap 0 before collapsed.
  const safegapFn = (idx: number): number => {
    if (kinds[idx] === null) return 0;
    return gapFn(idx);
  };

  return stack(children, { padY, gap: visibleCount > 1 ? safegapFn : 0 });
}
