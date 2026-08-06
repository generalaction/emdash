import { defineContract, liveJob, liveModel, liveState, mutation, procedure } from '@emdash/wire';
import {
  dependencyIdSchema,
  hostDependencyErrorSchema,
  hostDependencyResolveResultSchema,
  hostDependencySelectionSchema,
  hostDependencySnapshotSchema,
  hostDependencyViewResultSchema,
  hostDependencyViewSchema,
  installMethodSchema,
} from '@primitives/host-dependencies/api';
import { z } from 'zod';

const depInput = z.object({ id: dependencyIdSchema });
export const hostDependencyInstallRequestSchema = depInput.extend({
  method: installMethodSchema.optional(),
  elevate: z.boolean().optional(),
});
export type HostDependencyInstallRequest = z.output<typeof hostDependencyInstallRequestSchema>;

export const hostDependencyInstallBatchResultSchema = z.record(
  dependencyIdSchema,
  hostDependencyViewResultSchema
);
export type HostDependencyInstallBatchResult = z.output<
  typeof hostDependencyInstallBatchResultSchema
>;
export const hostDependencyOperationProgressSchema = z.object({
  phase: z.enum(['resolving', 'running', 'refreshing']),
});
export type HostDependencyOperationProgress = z.output<
  typeof hostDependencyOperationProgressSchema
>;

export const hostDependencyResolverContract = defineContract({
  resolve: procedure({
    input: depInput,
    output: hostDependencyResolveResultSchema,
  }),
});

export const hostDependenciesContract = defineContract({
  resolver: hostDependencyResolverContract,
  snapshot: liveModel({
    key: z.void().optional(),
    states: {
      current: liveState({ data: hostDependencySnapshotSchema }),
    },
    mutations: {
      setSelection: mutation({
        input: depInput.extend({ selection: hostDependencySelectionSchema }),
        data: hostDependencyViewSchema,
        error: hostDependencyErrorSchema,
      }),
      refresh: mutation({
        input: z.object({ id: dependencyIdSchema.optional() }).optional(),
        data: hostDependencySnapshotSchema,
        error: hostDependencyErrorSchema,
      }),
    },
  }),
  runSelfUpdateCommand: liveJob({
    input: depInput,
    progress: hostDependencyOperationProgressSchema,
    result: hostDependencyViewSchema,
    error: hostDependencyErrorSchema,
  }),
  runInstallCommand: liveJob({
    input: hostDependencyInstallRequestSchema.extend({
      commandKind: z.enum(['install', 'update']).optional(),
    }),
    progress: hostDependencyOperationProgressSchema,
    result: hostDependencyViewSchema,
    error: hostDependencyErrorSchema,
  }),
  runInstallBatch: liveJob({
    input: z.object({ requests: z.array(hostDependencyInstallRequestSchema).min(1) }),
    progress: hostDependencyOperationProgressSchema,
    result: hostDependencyInstallBatchResultSchema,
    error: hostDependencyErrorSchema,
  }),
});

export type HostDependencyResolverContract = typeof hostDependencyResolverContract;
export type HostDependenciesContract = typeof hostDependenciesContract;
