import { defineContract, liveModel, liveState, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { hostUsageSchema } from '#primitives/provider-usage/api';

export const providerUsageContract = defineContract({
  snapshot: liveModel({
    key: z.void().optional(),
    states: { current: liveState({ data: hostUsageSchema }) },
  }),
  refresh: procedure({ input: z.void().optional(), output: z.void() }),
});

export type ProviderUsageContract = typeof providerUsageContract;
