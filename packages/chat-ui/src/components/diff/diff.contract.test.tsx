/**
 * diff — height contract test.
 * Verifies that diffDef.measure().height equals the rendered offsetHeight.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasure } from '../../tests/contract';
import { diffDef } from './diff.def';
import { diffFixtures } from './diff.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('diffDef height contract', () => {
  for (const item of diffFixtures) {
    it(`path=${item.path}`, async () => {
      const { computed, dom } = await renderAndMeasure(diffDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
