import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import z from 'zod';
import {
  operationMutationErrorSchema,
  operationMutationResultSchema,
  operationTreeKeySchema,
  operationTreeListSchema,
} from '@core/primitives/operations/api';

export const operationIdInputSchema = z.object({
  operationId: z.string(),
});

export const operationsContract = defineContract({
  retry: fallible({
    input: operationIdInputSchema,
    data: operationMutationResultSchema,
    error: operationMutationErrorSchema,
  }),
  forget: fallible({
    input: operationIdInputSchema,
    data: operationMutationResultSchema,
    error: operationMutationErrorSchema,
  }),
  operationTrees: liveModel({
    key: operationTreeKeySchema,
    states: {
      list: liveState({ data: operationTreeListSchema }),
    },
  }),
});

export type OperationsContract = typeof operationsContract;
