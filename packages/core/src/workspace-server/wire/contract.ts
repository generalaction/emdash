import { defineContract, fallible, procedure } from '@emdash/wire';
import { z } from 'zod';
import { acpApiContract } from '../../acp';
import { depsContract } from '../deps/contract';
import { filesContract } from '../files/contract';
import { gitContract } from '../git/contract';
import { ptyAgentContract } from '../pty-agent/contract';
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
  deps: depsContract,
  ptyAgent: ptyAgentContract,
  acp: acpApiContract,
});
