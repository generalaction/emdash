import { defineContract, fallible, procedure } from '@emdash/wire';
import { z } from 'zod';
import { acpApiContract } from '../../acp';
import { gitContract } from '../../git/api/contract';
import { agentConfigContract } from '../agent-config/contract';
import { filesContract } from '../files/contract';
import { tuiAgentsContract } from '../tui-agents/contract';
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
  git: gitContract,
  files: filesContract,
  agentConfig: agentConfigContract,
  tuiAgents: tuiAgentsContract,
  acp: acpApiContract,
});
