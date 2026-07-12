import path from 'node:path';
import { ok, type Result } from '@emdash/shared';
import { RuntimeFileSystem } from '@main/core/files/runtime-files';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import {
  isSafePreservePattern,
  preservedDestinationPath,
  preservedRepoRelativePath,
} from '@main/core/projects/settings/preserve-pattern-safety';
import { isRealPathContained } from '@main/core/runtime/files-helpers';
import { log } from '@main/lib/logger';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/copy-preserved-files';
import type { StepContext } from './step-context';

export async function execute(
  _args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const targetPath = ctx.resolvedWorktreePath;
  if (!targetPath) {
    log.warn('setup-steps/copy-preserved-files: no resolved worktree path; skipping');
    return ok({});
  }

  try {
    const taskFs = new RuntimeFileSystem(targetPath);
    const settings = await getEffectiveTaskSettings({
      projectSettings: ctx.projectSettings,
      taskFs,
      taskConfigPath: path.join(targetPath, '.emdash.json'),
    });

    for (const pattern of settings.preservePatterns ?? []) {
      if (!isSafePreservePattern(nativePathOperations, pattern)) {
        log.warn('setup-steps/copy-preserved-files: skipping unsafe preserve pattern', { pattern });
        continue;
      }
      const matches = ctx.fileSystem.glob([pattern], { cwd: ctx.repoPath, dot: true });
      if (!matches.success) {
        log.warn('setup-steps/copy-preserved-files: failed to match preserve pattern', {
          pattern,
          error: matches.error,
        });
        continue;
      }
      for await (const absPath of matches.data) {
        const relPath = preservedRepoRelativePath(nativePathOperations, ctx.repoPath, absPath);
        if (!relPath || (await isTrackedSourcePath(relPath, ctx))) continue;
        const stat = await ctx.fileSystem.stat(absPath);
        if (!stat.success || stat.data.type !== 'file') continue;
        const destPath = preservedDestinationPath(nativePathOperations, targetPath, relPath);
        if (!destPath) continue;
        const contained = await isRealPathContained(targetPath, destPath);
        if (!contained.success || !contained.data) continue;

        const source = await ctx.fileSystem.readBytes(absPath);
        if (!source.success) continue;
        const copied = await taskFs.writeBytes(destPath, source.data.bytes);
        if (!copied.success) {
          log.warn('setup-steps/copy-preserved-files: failed to copy preserved file', {
            sourcePath: absPath,
            destPath,
            error: copied.error,
          });
        }
      }
    }
  } catch (error) {
    log.warn('setup-steps/copy-preserved-files: failed to copy preserved files', {
      targetPath,
      error: String(error),
    });
  }

  return ok({});
}

async function isTrackedSourcePath(relativePath: string, ctx: StepContext): Promise<boolean> {
  const result = await ctx.gitCheckout.getFileAtIndex(relativePath);
  return result.success && result.data !== null;
}

const nativePathOperations = {
  join: path.join,
  isAbsolute: path.isAbsolute,
  relative: path.relative,
  contains(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  },
};
