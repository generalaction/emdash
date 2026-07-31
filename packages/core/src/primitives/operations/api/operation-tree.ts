import z from 'zod';
import { operationDisplayStateSchema, type OperationDisplayState } from './operation-state';

export const operationTreeKeySchema = z.object({
  projectId: z.string().optional(),
});

export const operationTreeRollupStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'blocked-host-offline',
  'awaiting-confirmation',
  'failed',
]);

export const operationTreeSchema = z.object({
  root: operationDisplayStateSchema,
  children: z.array(operationDisplayStateSchema),
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

const ROLLUP_SEVERITY: readonly OperationTreeRollupStatus[] = [
  'failed',
  'awaiting-confirmation',
  'blocked-host-offline',
  'running',
  'waiting',
  'queued',
];

export function rollupStatus(nodes: readonly OperationDisplayState[]): OperationTreeRollupStatus {
  for (const status of ROLLUP_SEVERITY) {
    if (nodes.some((node) => node.status === status)) return status;
  }
  return 'queued';
}
