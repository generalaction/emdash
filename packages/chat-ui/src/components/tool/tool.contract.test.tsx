/**
 * tool — height contract tests.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasureUnit } from '../../tests/contract';
import { toolUnitDef } from './tool.def';
import { toolFixtures } from './tool.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('toolUnitDef height contract', () => {
  for (const item of toolFixtures) {
    it(`name=${item.name} status=${item.status}`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(toolUnitDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
