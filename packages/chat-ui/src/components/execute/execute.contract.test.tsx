/**
 * execute — height contract test.
 * Verifies that executeDef.measure().height equals the rendered offsetHeight.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasure } from '../../tests/contract';
import { executeDef } from './execute.def';
import { executeFixtures } from './execute.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('executeDef height contract', () => {
  for (const item of executeFixtures) {
    it(`status=${item.status}`, async () => {
      const { computed, dom } = await renderAndMeasure(executeDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
