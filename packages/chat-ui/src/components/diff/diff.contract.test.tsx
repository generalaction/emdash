/**
 * diff — height contract tests.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasureUnit } from '../../tests/contract';
import { diffUnitDef } from './diff.def';
import { diffFixtures } from './diff.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('diffUnitDef height contract', () => {
  for (const item of diffFixtures) {
    it(`path=${item.path}`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(diffUnitDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
