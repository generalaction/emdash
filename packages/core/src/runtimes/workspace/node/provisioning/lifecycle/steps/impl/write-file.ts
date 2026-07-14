import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { stringifyError } from './helpers';

export const writeFileImpl = implement(writeFileStep, async (args, ctx) => {
  const root = ctx.resolvedWorktreePath ?? ctx.repoPath;
  const resolved = resolveInside(root, args.path);
  if (!resolved) {
    return stepErr('permanent', {
      type: 'invalid-path',
      message: `File path "${args.path}" escapes the workspace`,
      resolutions: ['use-relative-path'],
    });
  }

  try {
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, args.content, 'utf8');
    return stepOk();
  } catch (error) {
    return stepErr('permanent', {
      type: 'write-file-failed',
      message: stringifyError(error),
    });
  }
});

function resolveInside(root: string, relativePath: string): string | undefined {
  if (path.isAbsolute(relativePath)) return undefined;
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedPath;
  }
  return undefined;
}
