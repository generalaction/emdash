import { rm } from 'node:fs/promises';
import { removeDirectoryStep } from '../catalog';
import { implement, stepErr, stepOk } from '../implement';

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
