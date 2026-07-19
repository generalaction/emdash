import { defineContract, fallible, procedure } from '@emdash/wire';
import { automationsContract } from '@runtimes/automations/api';
import { fileSearchContract } from '@runtimes/file-search/api';
import { hostRuntimesDefinitions } from '@services/runtime-broker/api';
import { z } from 'zod';
import { portForwardsContract } from '../port-forwards/contract';
import {
  wireHealthSchema,
  wireInitializeInputSchema,
  wireInitializeResultSchema,
  wireProtocolIncompatibleSchema,
} from './schemas';

export const workspaceWireContract = defineContract({
  health: procedure({ input: z.void().optional(), output: wireHealthSchema }),
  initialize: fallible({
    input: wireInitializeInputSchema,
    data: wireInitializeResultSchema,
    error: wireProtocolIncompatibleSchema,
  }),
  ...hostRuntimesDefinitions,
  fileSearch: fileSearchContract,
  automations: automationsContract,
  portForwards: portForwardsContract,
});
