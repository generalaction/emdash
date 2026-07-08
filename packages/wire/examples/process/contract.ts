import { z } from 'zod';
import { defineContract, liveModel, liveState, procedure } from '../../src/index';

export const processExampleApi = defineContract({
  ping: procedure({ input: z.string(), output: z.string() }),
  increment: procedure({ input: z.void().optional(), output: z.number() }),
  crash: procedure({ input: z.void().optional(), output: z.void() }),
  counter: liveModel({
    key: z.void().optional(),
    states: { counter: liveState({ data: z.object({ count: z.number() }) }) },
  }),
});
