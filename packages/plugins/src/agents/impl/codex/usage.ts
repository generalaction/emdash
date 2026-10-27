import type { UsageProbeResult, UsageWindow } from '@emdash/core/primitives/provider-usage/api';
import type { UsageProbeContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { z } from 'zod';
import { percent, withUsageRpc } from '../../helpers/usage-probe';

const accountResponse = z.object({
  account: z
    .object({
      type: z.string(),
      email: z.string().optional(),
      planType: z.string().optional(),
    })
    .nullable(),
});
const windowSchema = z.object({
  usedPercent: z.number().nullish(),
  windowDurationMins: z.number().positive().nullish(),
  resetsAt: z.number().nullish(),
});
const limitsSchema = z.object({
  limitId: z.string().nullish(),
  limitName: z.string().nullish(),
  planType: z.string().nullish(),
  primary: windowSchema.nullish(),
  secondary: windowSchema.nullish(),
});
const limitsResponse = z.object({
  accountId: z.string().nullish(),
  rateLimits: limitsSchema,
  rateLimitsByLimitId: z.record(z.string(), limitsSchema).nullish(),
});

export function codexUsageWindows(raw: unknown): { accountId?: string; windows: UsageWindow[] } {
  const data = limitsResponse.parse(raw);
  const buckets =
    data.rateLimitsByLimitId && Object.keys(data.rateLimitsByLimitId).length
      ? Object.entries(data.rateLimitsByLimitId)
      : [[data.rateLimits.limitId ?? 'codex', data.rateLimits] as const];
  const windows: UsageWindow[] = [];
  for (const [bucket, limits] of buckets) {
    for (const slot of ['primary', 'secondary'] as const) {
      const window = limits[slot];
      if (!window) continue;
      const minutes = window.windowDurationMins ?? undefined;
      const label =
        minutes === undefined
          ? slot === 'primary'
            ? 'Primary limit'
            : 'Secondary limit'
          : minutes >= 30 * 1440
            ? 'Monthly'
            : minutes >= 7 * 1440
              ? 'Weekly'
              : `${minutes / 60}-hour`;
      windows.push({
        id: `${bucket}:${slot}`,
        label: bucket === 'codex' ? label : `${limits.limitName ?? bucket} · ${label}`,
        usedPercent: percent(window.usedPercent),
        durationMinutes: minutes,
        resetsAt:
          typeof window.resetsAt === 'number' &&
          Number.isFinite(window.resetsAt) &&
          window.resetsAt > 0
            ? window.resetsAt * 1000
            : null,
      });
    }
  }
  return { accountId: data.accountId ?? undefined, windows };
}

export async function probeCodexUsage(ctx: UsageProbeContext): Promise<UsageProbeResult> {
  return withUsageRpc(ctx, async (rpc) => {
    await rpc.request('initialize', {
      clientInfo: { name: 'emdash_usage', title: 'Emdash Usage', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.notify('initialized');
    const { account: current } = accountResponse.parse(await rpc.request('account/read', {}));
    if (!current)
      return { status: 'signed-out', windows: [], message: 'Sign in with Codex on this machine.' };
    if (current.type !== 'chatgpt')
      return {
        status: 'unsupported',
        windows: [],
        message: 'Subscription limits are unavailable for this authentication method.',
      };
    const account = { email: current.email, plan: current.planType };
    try {
      const usage = codexUsageWindows(await rpc.request('account/rateLimits/read'));
      return {
        status: usage.windows.length ? 'ready' : 'unsupported',
        account: { ...account, id: usage.accountId },
        windows: usage.windows,
        ...(usage.windows.length ? {} : { message: 'Codex did not report subscription limits.' }),
      };
    } catch {
      return {
        status: 'unavailable',
        account,
        windows: [],
        message: 'Could not read limits. Check the Codex sign-in and CLI version.',
      };
    }
  });
}
