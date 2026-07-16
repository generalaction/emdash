import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';

const v1Schema = z.object({
  version: z.literal('1'),
  source: z.enum(['user', 'reconciler']),
  entityName: z.string().optional(),
  workspacePath: z.string().optional(),
  branchName: z.string().optional(),
  hostLabel: z.string().optional(),
  deleteWorktree: z.boolean().optional(),
  deleteBranch: z.boolean().optional(),
  acpConversationIds: z.array(z.string()).optional(),
  tuiConversationIds: z.array(z.string()).optional(),
  terminalSessionIds: z.array(z.string()).optional(),
  tmuxSessionNames: z.array(z.string()).optional(),
  confirmationReason: z.enum(['stale', 'workspace-modified', 'reconciler-proposed']).optional(),
  confirmedAt: z.number().int().nonnegative().optional(),
});

export const operationPayload = defineVersionedSchema().initial('1', v1Schema).build();

export type OperationPayload = typeof operationPayload.Type;
