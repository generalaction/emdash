import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';

const diffStatsSchema = z.object({
  added: z.number().int().nonnegative().optional(),
  deleted: z.number().int().nonnegative().optional(),
});

const v1Schema = z.object({
  version: z.literal('1'),
  adminName: z.string().optional(),
  dirty: z.boolean().optional(),
  diffStats: diffStatsSchema.optional(),
  ahead: z.number().int().nonnegative().optional(),
  behind: z.number().int().nonnegative().optional(),
  corruptionReason: z.string().optional(),
  desktopObservedAt: z.string().optional(),
});

export const workspaceObservedData = defineVersionedSchema().initial('1', v1Schema).build();

export type WorkspaceObservedData = typeof workspaceObservedData.Type;
