/**
 * file-op — height contract test.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasure } from '../../tests/contract';
import { fileOpDef } from './file-op.def';
import { fileOpFixtures } from './file-op.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('fileOpDef height contract', () => {
  for (const item of fileOpFixtures) {
    it(`op=${item.op} count=${item.ops.length} status=${item.status}`, async () => {
      const { computed, dom } = await renderAndMeasure(fileOpDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
