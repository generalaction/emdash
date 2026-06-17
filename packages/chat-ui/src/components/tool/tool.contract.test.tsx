/**
 * tool — height contract test.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasure } from '../../tests/contract';
import { toolDef } from './tool.def';
import { toolFixtures } from './tool.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('toolDef height contract', () => {
  for (const item of toolFixtures) {
    it(`name=${item.name} status=${item.status}`, async () => {
      const { computed, dom } = await renderAndMeasure(toolDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
