import { mkdir, stat } from 'node:fs/promises';
import { createDirectoryStep } from '../catalog';
import { implement, stepErr, stepOk } from '../implement';

export const createDirectoryImpl = implement(createDirectoryStep, async (args) => {
  try {
    const existing = await stat(args.path).catch(() => undefined);
    if (existing && !existing.isDirectory()) {
      return stepErr('conflict', {
        type: 'path-exists',
        message: `Path "${args.path}" exists and is not a directory`,
        resolutions: ['choose-another-path'],
      });
    }

    await mkdir(args.path, { recursive: true });
    return stepOk({ facts: { created: !existing, path: args.path } });
  } catch (error) {
    return stepErr('permanent', {
      type: 'create-directory-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
