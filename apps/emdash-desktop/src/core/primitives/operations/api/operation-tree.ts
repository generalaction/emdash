import z from 'zod';
import { deletionStateSchema } from './deletion';

export const operationTreeKeySchema = z.object({
  projectId: z.string().optional(),
});

export const operationTreeRollupStatusSchema = z.enum([
  'cleaning',
  'waiting',
  'blocked-host-offline',
  'awaiting-confirmation',
  'failed',
]);

export const operationTreeSchema = z.object({
  root: deletionStateSchema,
  children: z.array(deletionStateSchema),
  rollup: z.object({
    total: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    status: operationTreeRollupStatusSchema,
  }),
});

export const operationTreeListSchema = z.record(z.string(), operationTreeSchema);

export type OperationTreeKey = z.infer<typeof operationTreeKeySchema>;
export type OperationTreeRollupStatus = z.infer<typeof operationTreeRollupStatusSchema>;
export type OperationTree = z.infer<typeof operationTreeSchema>;
export type OperationTreeList = z.infer<typeof operationTreeListSchema>;
