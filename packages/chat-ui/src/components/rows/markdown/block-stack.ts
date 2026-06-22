import { stack } from '@core/compose';
import type { StackLayout } from '@core/compose';
import type { DensityScale } from '@core/config';
import type { Measured, MeasureCtx } from '@core/define';
import type { BlockLeafLayout } from '@core/layout/layout-types';
import type { Block, CodeBlock, ProseBlock, TableBlock } from '@core/markdown/document';
import { resolveSeamGap } from '@core/spacing';
import type { Margin } from '@core/spacing';
import { BLOCK_REGISTRY } from './block-registry';

// ── Block margin table ────────────────────────────────────────────────────────
//
// Resolved per-kind margins, recomputed only when the theme version changes.
// Registry-driven: iterating BLOCK_REGISTRY means adding or removing a block
// def flows through here automatically with no edits to layoutBlockStack.
//
// Single-entry cache keyed by theme.version (monotonic, per buildChatTheme
// call). The same invalidation strategy is used by measureBlockCached above.

let _marginTableVersion = -1;
let _marginTable: Record<string, Margin | undefined> = {};

function resolvedBlockMargins(
  density: DensityScale,
  version: number
): Record<string, Margin | undefined> {
  if (version !== _marginTableVersion) {
    const table: Record<string, Margin | undefined> = {};
    for (const kind of Object.keys(BLOCK_REGISTRY)) {
      table[kind] = BLOCK_REGISTRY[kind as Block['kind']].margin?.(density);
    }
    _marginTable = table;
    _marginTableVersion = version;
  }
  return _marginTable;
}

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
  isCollapsed?: (id: string) => boolean;
};

export function layoutBlockStack(
  blocks: Block[],
  ctx: MeasureCtx,
  opts: BlockStackOpts = {}
): Measured<StackLayout> {
  const { padY = 0, isCollapsed = () => false } = opts;

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

  // Resolve each seam gap via margin-collapse: max(prev.margin.bottom, cur.margin.top).
  // The collapse-through scan (skipping null/collapsed blocks) mirrors the old
  // prevVisible walk and is behavior-preserving:
  //   prose↔prose → max(proseGap, proseGap) = proseGap  (same as before)
  //   prose↔code  → max(proseGap, blockGap) = blockGap  (same as before)
  //   code↔code   → max(blockGap, blockGap) = blockGap  (same as before)
  //
  // The margin table is resolved once per theme version (not per seam) and the
  // marginOf lookup is hoisted once per layoutBlockStack call so gapFn
  // allocates nothing extra per seam.
  const density = ctx.theme.density;
  const km = resolvedBlockMargins(density, ctx.theme.version);
  const marginOf = (k: string) => km[k];
  const gapFn = (idx: number): number => {
    const curKind = kinds[idx];
    if (curKind === null) return 0;
    let prevKind: Block['kind'] | null = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (kinds[j] !== null) {
        prevKind = kinds[j] as Block['kind'];
        break;
      }
    }
    if (prevKind === null) return 0;
    return resolveSeamGap(prevKind, curKind, marginOf, density.blockGap);
  };

  const safegapFn = (idx: number): number => {
    if (kinds[idx] === null) return 0;
    return gapFn(idx);
  };

  return stack(children, { padY, gap: visibleCount > 1 ? safegapFn : 0 });
}
