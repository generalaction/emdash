import {
  providerUsageSchema,
  usageAccountSchema,
  usageWindowSchema,
} from '@emdash/core/primitives/provider-usage/api';
import { z } from 'zod';

export const usageMachineSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['connected', 'disconnected', 'checking', 'upgrade-required', 'error']),
  providers: z.array(providerUsageSchema),
});
export const usageAccountViewSchema = z.object({
  key: z.string(),
  providerId: z.string(),
  account: usageAccountSchema,
  sources: z.array(
    z.object({
      machineId: z.string(),
      machineName: z.string(),
      status: z.string(),
      refreshing: z.boolean(),
    })
  ),
  windows: z.array(
    usageWindowSchema.extend({ observedAt: z.number(), sourceName: z.string(), stale: z.boolean() })
  ),
  message: z.string().optional(),
});
export const usageOverviewSchema = z.object({
  accounts: z.array(usageAccountViewSchema),
  machines: z.array(usageMachineSchema),
  error: z.string().optional(),
});
export type UsageMachine = z.infer<typeof usageMachineSchema>;
export type UsageAccountView = z.infer<typeof usageAccountViewSchema>;
export type UsageOverview = z.infer<typeof usageOverviewSchema>;
