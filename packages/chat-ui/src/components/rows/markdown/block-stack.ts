import { stack } from '../../../core/compose';
import type { StackLayout } from '../../../core/compose';
import type { Measured, MeasureCtx } from '../../../core/define';
import type { BlockLeafLayout } from '../../../core/layout/layout-types';
import type { Block, CodeBlock, ProseBlock, TableBlock } from '../../../core/markdown/document';
import { BLOCK_REGISTRY } from './block-registry';

// ── Per-block memo ────────────────────────────────────────────────────────────
//
// WeakMap keyed by Block object. Skips re-measures for unchanged blocks inside
// streaming rows. Fingerprint includes measureEpoch, theme.version, width, and
// collapsed state so the cache is invalidated correctly on any relevant change.

const blockMemo = new WeakMap<Block, { fingerprint: string; result: Measured<BlockLeafLayout> }>();

export function measureBlockCached(block: Block, ctx: MeasureCtx): Measured<BlockLeafLayout> {
  const fingerprint = `${ctx.measureEpoch ?? 0}|${ctx.theme.version}|${ctx.width}|${ctx.isCollapsed(block.id)}`;
  const cached = blockMemo.get(block);
  if (cached?.fingerprint === fingerprint) return cached.result;

  // oxlint-disable-next-line typescript/no-explicit-any -- BLOCK_REGISTRY is typed at boundary
  const result: Measured<BlockLeafLayout> = BLOCK_REGISTRY[block.kind].measure(block as any, ctx);
  blockMemo.set(block, { fingerprint, result });
  return result;
}

// ── layoutBlockStack ─────────────────────────────────────────────────────────

export type BlockStackOpts = {
  padY?: number;
  blockGap?: number;
  proseGap?: number;
  isCollapsed?: (id: string) => boolean;
};

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
      // Zero-height placeholder keeps block IDs stable but contributes no height.
      const zeroMeasured: Measured<BlockLeafLayout> = {
        height: 0,
        width: 0,
        layout: (() => {
          if (block.kind === 'prose') {
            return {
              kind: 'prose' as const,
              id: block.id,
              top: 0,
              height: 0,
              contentWidth: 0,
              lineHeight: 0,
              lines: [],
              raw: block as ProseBlock,
            };
          }
          if (block.kind === 'code') {
            return {
              kind: 'code' as const,
              id: block.id,
              top: 0,
              height: 0,
              contentWidth: 0,
              lines: [],
              raw: block as CodeBlock,
            };
          }
          return {
            kind: 'table' as const,
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
        })(),
      };
      children.push({ id: block.id, measured: zeroMeasured });
      continue;
    }

    children.push({ id: block.id, measured: measureBlockCached(block, ctx) });
    visibleCount++;
  }

  const kinds: Array<Block['kind'] | null> = blocks.map((b) => (isCollapsed(b.id) ? null : b.kind));

  const gapFn = (idx: number): number => {
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

  const safegapFn = (idx: number): number => {
    if (kinds[idx] === null) return 0;
    return gapFn(idx);
  };

  return stack(children, { padY, gap: visibleCount > 1 ? safegapFn : 0 });
}
