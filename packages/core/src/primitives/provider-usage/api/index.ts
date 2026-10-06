import { z } from 'zod';

/** Only public account metadata crosses the host boundary. Never include credentials. */
export const usageAccountSchema = z.object({
  id: z.string().optional(),
  email: z.string().optional(),
  organization: z.string().optional(),
  plan: z.string().optional(),
});

export const usageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPercent: z.number().min(0).max(100).nullable(),
  resetsAt: z.number().nullable(),
  durationMinutes: z.number().positive().optional(),
});

export const usageProbeSchema = z.object({
  status: z.enum(['ready', 'signed-out', 'unsupported', 'unavailable']),
  account: usageAccountSchema.optional(),
  windows: z.array(usageWindowSchema),
  message: z.string().optional(),
});

export const providerUsageSchema = usageProbeSchema.extend({
  providerId: z.string(),
  status: z.enum(['loading', 'ready', 'signed-out', 'unsupported', 'unavailable', 'missing-cli']),
  refreshing: z.boolean(),
  checkedAt: z.number().nullable(),
  observedAt: z.number().nullable(),
});

export const hostUsageSchema = z.object({
  sampledAt: z.number(),
  providers: z.array(providerUsageSchema),
});
export type UsageAccount = z.infer<typeof usageAccountSchema>;
export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type UsageProbeResult = z.infer<typeof usageProbeSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type HostUsage = z.infer<typeof hostUsageSchema>;

export const USAGE_CACHE_MS = 5 * 60_000;

/** Scope is part of identity; one email can have several separate subscriptions. */
export function usageAccountIdentity(account: UsageAccount): string | undefined {
  const identity = account.id
    ? ['id', account.id]
    : account.email
      ? ['email', account.email.trim().toLowerCase()]
      : undefined;
  if (!identity) return undefined;
  return JSON.stringify([
    ...identity,
    account.organization ?? '',
    account.id ? '' : (account.plan ?? '').toLowerCase(),
  ]);
}
