import { defineContract, liveJob, liveModel, liveState, mutation, procedure } from '@emdash/wire';
import {
  dependencyIdSchema,
  hostDependencyErrorSchema,
  hostDependencyResolveResultSchema,
  hostDependencySelectionSchema,
  hostDependencySnapshotSchema,
  hostDependencyViewSchema,
} from '@primitives/host-dependencies/api';
import { z } from 'zod';

const depInput = z.object({ id: dependencyIdSchema });

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
  runUpdateCommand: liveJob({
    input: depInput,
    progress: z.object({ phase: z.enum(['resolving', 'running', 'refreshing']) }),
    result: hostDependencyViewSchema,
    error: hostDependencyErrorSchema,
  }),
});

export type HostDependencyResolverContract = typeof hostDependencyResolverContract;
export type HostDependenciesContract = typeof hostDependenciesContract;
