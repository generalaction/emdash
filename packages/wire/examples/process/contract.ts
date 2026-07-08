import { z } from 'zod';
import { defineContract, defineLiveModelContract, procedure } from '../../src/index';

export const processExampleApi = defineContract({
  ping: procedure({ input: z.string(), output: z.string() }),
  increment: procedure({ input: z.void().optional(), output: z.number() }),
  crash: procedure({ input: z.void().optional(), output: z.void() }),
  counter: defineLiveModelContract({
    key: z.void().optional(),
    models: { counter: z.object({ count: z.number() }) },
  }),
});
