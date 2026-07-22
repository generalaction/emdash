import { defineContract, liveModel, liveState, procedure } from '@emdash/wire/api';
import { z } from 'zod';

export const remoteMachineServerStatusSchema = z.enum([
  'not-installed',
  'stopped',
  'booting',
  'shutting-down',
  'healthy',
  'failed',
]);

export const remoteMachineServerStateSchema = z.object({
  status: remoteMachineServerStatusSchema,
  version: z.string().optional(),
  latestVersion: z.string().optional(),
  startedAt: z.number().optional(),
  detail: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

const remoteMachineServerRuntimeSchema = z.record(z.string(), remoteMachineServerStateSchema);
const connectionInputSchema = z.object({ connectionId: z.string().min(1) });

export type RemoteMachineServerStatus = z.infer<typeof remoteMachineServerStatusSchema>;
export type RemoteMachineServerState = z.infer<typeof remoteMachineServerStateSchema>;
export type RemoteMachineServerRuntime = z.infer<typeof remoteMachineServerRuntimeSchema>;

export const remoteMachineContract = defineContract({
  serverStates: liveModel({
    key: z.void(),
    states: {
      runtime: liveState({ data: remoteMachineServerRuntimeSchema }),
    },
  }),
  refreshServerState: procedure({ input: connectionInputSchema, output: z.void() }),
  installServer: procedure({ input: connectionInputSchema, output: z.void() }),
  startServer: procedure({ input: connectionInputSchema, output: z.void() }),
  stopServer: procedure({ input: connectionInputSchema, output: z.void() }),
  restartServer: procedure({ input: connectionInputSchema, output: z.void() }),
  updateServer: procedure({ input: connectionInputSchema, output: z.void() }),
});
