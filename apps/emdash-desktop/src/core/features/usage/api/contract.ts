import { defineContract, liveModel, liveState, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { usageOverviewSchema } from './schemas';

export const usageDomain = 'usage' as const;

export const usageContract = defineContract({
  overview: liveModel({
    key: z.void().optional(),
    states: { current: liveState({ data: usageOverviewSchema }) },
  }),
  refresh: procedure({ input: z.void().optional(), output: z.void() }),
});
