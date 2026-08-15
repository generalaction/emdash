import { defineContract, liveModel, liveState, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

export const hostServerStatusSchema = z.enum([
  'not-installed',
  'stopped',
  'booting',
  'shutting-down',
  'healthy',
  'failed',
]);

export const hostServerStateSchema = z.object({
  status: hostServerStatusSchema,
  version: z.string().optional(),
  latestVersion: z.string().optional(),
  updateAvailable: z.boolean().optional(),
  startedAt: z.number().optional(),
  detail: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

const hostServerRuntimeSchema = z.record(z.string(), hostServerStateSchema);
const connectionInputSchema = z.object({ connectionId: z.string().min(1) });
const refreshServerStateInputSchema = connectionInputSchema.extend({
  force: z.boolean().optional(),
});

export type HostServerStatus = z.infer<typeof hostServerStatusSchema>;
export type HostServerState = z.infer<typeof hostServerStateSchema>;
export type HostServerRuntime = z.infer<typeof hostServerRuntimeSchema>;

export function isServerUsable(state: HostServerState | undefined): boolean {
  return state?.status === 'healthy' && state.error === undefined;
}

export const hostsDomain = 'hosts' as const;

export const hostsContract = defineContract({
  serverStates: liveModel({
    key: z.void(),
    states: {
      runtime: liveState({ data: hostServerRuntimeSchema }),
    },
  }),
  refreshServerState: procedure({ input: refreshServerStateInputSchema, output: z.void() }),
  installServer: procedure({ input: connectionInputSchema, output: z.void() }),
  startServer: procedure({ input: connectionInputSchema, output: z.void() }),
  stopServer: procedure({ input: connectionInputSchema, output: z.void() }),
  restartServer: procedure({ input: connectionInputSchema, output: z.void() }),
  updateServer: procedure({ input: connectionInputSchema, output: z.void() }),
});
