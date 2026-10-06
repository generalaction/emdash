import { definePluginCapability } from '@emdash/shared/plugins';
import { z } from 'zod';
import type { UsageProbeResult } from '#primitives/provider-usage/api';

export type UsageProbeContext = {
  cli: string;
  env: Record<string, string>;
  cwd: string;
  signal: AbortSignal;
};

export type IUsageLimitsBehavior = {
  /** Read account-wide subscription limits without sending a prompt. */
  probe(context: UsageProbeContext): Promise<UsageProbeResult>;
};

export const usageLimitsCapability = definePluginCapability<IUsageLimitsBehavior>()(
  'usageLimits',
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('supported') }),
  ]),
  { kind: 'none' },
  { requiresBehavior: (descriptor) => descriptor.kind === 'supported' }
);
