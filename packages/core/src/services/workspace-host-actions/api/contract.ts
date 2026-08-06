import { defineContract, fallible } from '@emdash/wire/rpc';
import {
  initializeWorkspaceRequestSchema,
  initializeWorkspaceResultSchema,
  workspaceHostActionErrorSchema,
} from './schemas';

export const workspaceHostActionsContract = defineContract({
  initializeWorkspace: fallible({
    input: initializeWorkspaceRequestSchema,
    data: initializeWorkspaceResultSchema,
    error: workspaceHostActionErrorSchema,
  }),
});

export type WorkspaceHostActionsContract = typeof workspaceHostActionsContract;
