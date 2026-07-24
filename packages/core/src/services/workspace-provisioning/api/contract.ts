import { defineContract, liveJob } from '@emdash/wire';
import {
  workspaceProvisioningErrorSchema,
  workspaceProvisioningInputSchema,
  workspaceProvisioningProgressSchema,
  workspaceProvisioningResultSchema,
} from './schemas';

export const workspaceProvisioningDefinitions = {
  provisionFromIntent: liveJob({
    input: workspaceProvisioningInputSchema,
    progress: workspaceProvisioningProgressSchema,
    result: workspaceProvisioningResultSchema,
    error: workspaceProvisioningErrorSchema,
  }),
};

export const workspaceProvisioningContract = defineContract(workspaceProvisioningDefinitions);

export type WorkspaceProvisioningContract = typeof workspaceProvisioningContract;
