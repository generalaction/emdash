import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';

export const telemetryContract = defineContract({
  capture: procedure({
    input: z.object({
      event: z.string(),
      properties: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.void(),
  }),
  getStatus: procedure({
    input: z.void(),
    output: z.object({
      status: z.object({
        enabled: z.boolean(),
        envDisabled: z.boolean(),
        userOptOut: z.boolean(),
        hasKeyAndHost: z.boolean(),
        session_id: z.string().nullable(),
        instance_id: z.string().nullable(),
      }),
    }),
  }),
  setEnabled: procedure({ input: z.object({ enabled: z.boolean() }), output: z.void() }),
  getFeatureFlags: procedure({
    input: z.void(),
    output: z.record(z.string(), z.boolean()),
  }),
});
