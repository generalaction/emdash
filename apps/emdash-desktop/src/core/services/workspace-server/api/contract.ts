import { defineContract, liveModel, liveState } from '@emdash/wire/api';
import { z } from 'zod';

export const provisioningPhaseSchema = z.enum([
  'probing',
  'installing',
  'starting',
  'ready',
  'failed',
]);

export const provisioningStatusSchema = z.object({
  phase: provisioningPhaseSchema,
  detail: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

const provisioningRuntimeSchema = z.record(z.string(), provisioningStatusSchema);

export type WorkspaceServerProvisioningStatus = z.infer<typeof provisioningStatusSchema>;
export type WorkspaceServerProvisioningRuntime = z.infer<typeof provisioningRuntimeSchema>;

export const workspaceServerDesktopContract = defineContract({
  provisioning: liveModel({
    key: z.void(),
    states: {
      runtime: liveState({ data: provisioningRuntimeSchema }),
    },
  }),
});
