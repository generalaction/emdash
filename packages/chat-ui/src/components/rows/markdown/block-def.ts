import type { JSX } from 'solid-js';
import type { Measured, MeasureCtx } from '../../../core/define';
import type { BlockLeafLayout } from '../../../core/layout/layout-types';
import type { Block } from '../../../core/markdown/document';

export type BlockDef<B extends Block, L extends BlockLeafLayout> = {
  kind: B['kind'];
  measure(block: B, ctx: MeasureCtx): Measured<L>;
  Render(props: { node: Measured<L> }): JSX.Element;
};

export function defineBlock<B extends Block, L extends BlockLeafLayout>(
  d: BlockDef<B, L>
): BlockDef<B, L> {
  return d;
}
