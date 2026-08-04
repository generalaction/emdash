import { defineContract, fallible } from '@emdash/wire';
import {
  createWorktreeActionSchema,
  initializeWorkspaceRequestSchema,
  initializeWorkspaceResultSchema,
  workspaceHostActionQuerySchema,
  workspaceHostActionSubmitResultSchema,
  workspaceHostActionViewSchema,
  workspaceHostActionErrorSchema,
} from './schemas';

export const workspaceHostActionsContract = defineContract({
  submitOperation: fallible({
    input: createWorktreeActionSchema,
    data: workspaceHostActionSubmitResultSchema,
    error: workspaceHostActionErrorSchema,
  }),
  getOperation: fallible({
    input: workspaceHostActionQuerySchema,
    data: workspaceHostActionViewSchema.nullable(),
    error: workspaceHostActionErrorSchema,
  }),
  initializeWorkspace: fallible({
    input: initializeWorkspaceRequestSchema,
    data: initializeWorkspaceResultSchema,
    error: workspaceHostActionErrorSchema,
  }),
});

export type WorkspaceHostActionsContract = typeof workspaceHostActionsContract;
