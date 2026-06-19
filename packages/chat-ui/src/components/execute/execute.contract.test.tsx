/**
 * execute — height contract tests.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasureUnit } from '../../tests/contract';
import { executeUnitDef } from './execute.def';
import { executeFixtures } from './execute.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('executeUnitDef height contract', () => {
  for (const item of executeFixtures) {
    it(`status=${item.status}`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(executeUnitDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
