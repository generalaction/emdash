import { defineContract, fallible, procedure } from '@emdash/wire';
import { acpApiContract } from '@runtimes/acp/api';
import { agentConfigContract } from '@runtimes/agent-config/api/contract';
import { filesContract } from '@runtimes/files/api/api/contract';
import { gitContract } from '@runtimes/git/api/api/contract';
import { tuiAgentsContract } from '@runtimes/tui-agents/api/contract';
import { workspaceContract } from '@runtimes/workspace/api';
import { hostDependenciesContract } from '@services/host-dependencies/api';
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
  git: gitContract,
  files: filesContract,
  agentConfig: agentConfigContract,
  tuiAgents: tuiAgentsContract,
  acp: acpApiContract,
  hostDependencies: hostDependenciesContract,
  workspace: workspaceContract,
  portForwards: portForwardsContract,
});
