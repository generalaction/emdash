import { rm } from 'node:fs/promises';
import { removeDirectoryStep } from '@services/workspace-lifecycle/api/steps/catalog';
import { implement, stepErr, stepOk } from '@services/workspace-lifecycle/api/steps/implement';

export const removeDirectoryImpl = implement(removeDirectoryStep, async (args) => {
  try {
    await rm(args.path, { recursive: true, force: true });
    return stepOk();
  } catch (error) {
    return stepErr('permanent', {
      type: 'remove-directory-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
