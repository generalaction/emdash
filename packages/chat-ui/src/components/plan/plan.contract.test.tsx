/**
 * plan — height contract test for planUnitDef.
 *
 * Verifies that planUnitDef.measure(item, ctx) equals the offsetHeight of the
 * rendered Render component, for both collapsed (default) and expanded states.
 *
 * Inverted collapse semantics: isCollapsed=true → expanded; isCollapsed=false → collapsed.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasureUnit } from '../../tests/contract';
import { planUnitDef } from './plan.def';
import { planFixtures } from './plan.fixtures';

// Collapsed state: isCollapsed=false → not expanded (plan shows capped preview).
const ctxCollapsed = makeContractCtx({ width: 640, isCollapsed: () => false });
// Expanded state: isCollapsed=true → expanded (inverted semantics).
const ctxExpanded = makeContractCtx({ width: 640, isCollapsed: () => true });

describe('planUnitDef height contract', () => {
  for (const item of planFixtures) {
    it(`id=${item.id} collapsed`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(planUnitDef, item, ctxCollapsed);
      expect(dom).toBe(computed);
    });
    it(`id=${item.id} expanded`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(planUnitDef, item, ctxExpanded);
      expect(dom).toBe(computed);
    });
  }
});
