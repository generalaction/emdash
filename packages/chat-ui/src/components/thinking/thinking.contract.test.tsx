/**
 * thinking — height contract test.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasure } from '../../tests/contract';
import { thinkingDef } from './thinking.def';
import { thinkingFixtures } from './thinking.fixtures';

// Collapsed (header-only) context.
const ctxCollapsed = makeContractCtx({ width: 640, isCollapsed: () => true });
// Expanded context.
const ctxExpanded = makeContractCtx({ width: 640, isCollapsed: () => false });

describe('thinkingDef height contract', () => {
  for (const item of thinkingFixtures) {
    it(`status=${item.status} collapsed`, async () => {
      const { computed, dom } = await renderAndMeasure(thinkingDef, item, ctxCollapsed);
      expect(dom).toBe(computed);
    });
    it(`status=${item.status} expanded`, async () => {
      const { computed, dom } = await renderAndMeasure(thinkingDef, item, ctxExpanded);
      expect(dom).toBe(computed);
    });
  }
});
