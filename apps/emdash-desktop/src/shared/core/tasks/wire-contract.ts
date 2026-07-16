import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import z from 'zod';
import {
  deletionListSchema,
  deletionModelKeySchema,
  deletionMutationErrorSchema,
  deletionMutationResultSchema,
} from '@shared/core/operations/deletion';

export const deleteTaskInputSchema = z.object({
  taskId: z.string(),
  deleteWorktree: z.boolean().optional(),
  deleteBranch: z.boolean().optional(),
});

const taskIdInputSchema = z.object({
  taskId: z.string(),
});

export const tasksWireContract = defineContract({
  delete: fallible({
    input: deleteTaskInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  retryDelete: fallible({
    input: taskIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  forgetWithoutCleanup: fallible({
    input: taskIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  deletions: liveModel({
    key: deletionModelKeySchema,
    states: {
      list: liveState({ data: deletionListSchema }),
    },
  }),
});

export type DeleteTaskInput = z.infer<typeof deleteTaskInputSchema>;
export type TasksWireContract = typeof tasksWireContract;
