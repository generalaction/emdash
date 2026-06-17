/**
 * islandDef — ComponentDef for IslandBlock / IslandLaidOut (block tier).
 *
 * Islands use a fixed initial height from `theme.geometry.islandFixedH` that
 * is replaced by an exact DOM-measured height once the content has mounted
 * (via MeasuredBlockFrame → ctx.setMeasured → ctx.measured write-back loop).
 */

import type { IslandBlock } from '../../core/blocks/block-types';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { IslandLaidOut } from '../../core/layout/layout-types';
import { Island } from './Island';

export type IslandDefLayout = IslandLaidOut & { kind: 'island' };

function IslandRender(props: {
  item: IslandBlock;
  layout: Measured<IslandDefLayout>;
  ctx: RenderCtx;
}) {
  const onMeasured = (id: string, h: number) => props.ctx.setMeasured(id, h);
  return <Island block={props.layout.layout} onMeasured={onMeasured} />;
}

export const islandDef = defineComponent<IslandBlock, IslandDefLayout>({
  kind: 'island',

  estimate(_item, ctx: MeasureCtx): number {
    return ctx.theme.geometry.islandFixedH;
  },

  measure(item, ctx: MeasureCtx): Measured<IslandDefLayout> {
    const height = ctx.measured(item.id) ?? ctx.theme.geometry.islandFixedH;

    const laid: IslandLaidOut = {
      kind: 'island',
      id: item.id,
      top: 0,
      height,
      contentWidth: ctx.width,
      islandType: item.islandType,
      raw: item.raw,
    };

    return {
      height,
      width: ctx.width,
      layout: { ...laid, kind: 'island' },
    };
  },

  Render: IslandRender,
});
