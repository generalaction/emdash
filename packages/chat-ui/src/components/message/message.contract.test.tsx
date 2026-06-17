/**
 * message — height contract test.
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasure } from '../../tests/contract';
import { messageDef } from './message.def';
import { messageFixtures } from './message.fixtures';

const ctx = makeContractCtx({ width: 640 });

describe('messageDef height contract', () => {
  for (const item of messageFixtures) {
    it(`role=${item.role} id=${item.id}`, async () => {
      const { computed, dom } = await renderAndMeasure(messageDef, item, ctx);
      expect(dom).toBe(computed);
    });
  }
});
