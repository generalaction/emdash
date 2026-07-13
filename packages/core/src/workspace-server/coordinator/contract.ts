import { defineContract, liveJob } from '@emdash/wire';
import {
  activateInputSchema,
  coordinatorErrorSchema,
  coordinatorProgressSchema,
  coordinatorResultSchema,
  deactivateInputSchema,
  teardownInputSchema,
} from './schema';

export const workspaceCoordinatorContract = defineContract({
  activate: liveJob({
    input: activateInputSchema,
    progress: coordinatorProgressSchema,
    result: coordinatorResultSchema,
    error: coordinatorErrorSchema,
  }),
  deactivate: liveJob({
    input: deactivateInputSchema,
    progress: coordinatorProgressSchema,
    result: coordinatorResultSchema,
    error: coordinatorErrorSchema,
  }),
  teardown: liveJob({
    input: teardownInputSchema,
    progress: coordinatorProgressSchema,
    result: coordinatorResultSchema,
    error: coordinatorErrorSchema,
  }),
});
