/**
 * thinking — height contract tests.
 *
 * Inverted collapse semantics:
 *   isCollapsed=true  → expanded (body visible)
 *   isCollapsed=false → collapsed (header-only for done; header+preview for active)
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasureUnit } from '../../tests/contract';
import { thinkingUnitDef } from './thinking.def';
import { thinkingFixtures } from './thinking.fixtures';

// isCollapsed=false → not expanded (collapsed; header-only or preview state)
const ctxCollapsed = makeContractCtx({ width: 640, isCollapsed: () => false });
// isCollapsed=true → expanded (inverted semantics)
const ctxExpanded = makeContractCtx({ width: 640, isCollapsed: () => true });

describe('thinkingUnitDef height contract', () => {
  for (const item of thinkingFixtures) {
    it(`status=${item.status} collapsed`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(thinkingUnitDef, item, ctxCollapsed);
      expect(dom).toBe(computed);
    });
    it(`status=${item.status} expanded`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(thinkingUnitDef, item, ctxExpanded);
      expect(dom).toBe(computed);
    });
  }
});
