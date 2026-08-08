import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  workspaceHostErrorSchema,
  workspaceHostInitializeRequestSchema,
  workspaceHostInitializeResultSchema,
  workspaceHostNoticesListSchema,
  workspaceHostRunScriptRequestSchema,
  workspaceHostRunScriptResultSchema,
} from './schemas';

export const workspaceHostContract = defineContract({
  initializeWorkspace: fallible({
    input: workspaceHostInitializeRequestSchema,
    data: workspaceHostInitializeResultSchema,
    error: workspaceHostErrorSchema,
  }),
  runWorkspaceScript: fallible({
    input: workspaceHostRunScriptRequestSchema,
    data: workspaceHostRunScriptResultSchema,
    error: workspaceHostErrorSchema,
  }),
  notices: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: workspaceHostNoticesListSchema }),
    },
  }),
});

export type WorkspaceHostContract = typeof workspaceHostContract;
