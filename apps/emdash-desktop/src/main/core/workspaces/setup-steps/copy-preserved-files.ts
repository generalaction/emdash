import type { IFileSystem } from '@emdash/core/files';
import { ok, type Result } from '@emdash/shared';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import {
  isSafePreservePattern,
  preservedDestinationPath,
  preservedRepoRelativePath,
} from '@main/core/projects/settings/preserve-pattern-safety';
import { log } from '@main/lib/logger';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/copy-preserved-files';
import type { StepContext } from './step-context';

function makeTaskFs(ctx: StepContext): IFileSystem | null {
  const opened = ctx.files.fileSystem();
  if (opened.success) return opened.data;
  log.warn('setup-steps/copy-preserved-files: failed to open task filesystem', opened.error);
  return null;
}

async function isTrackedSourcePath(absPath: string, ctx: StepContext): Promise<boolean> {
  try {
    const relPath = ctx.files.path.relative(ctx.repoPath, absPath);
    await ctx.ctx.exec('git', ['ls-files', '--error-unmatch', '--', relPath]);
    return true;
  } catch {
    return false;
  }
}

export async function execute(
  _args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const targetPath = ctx.resolvedWorktreePath;
  if (!targetPath) {
    log.warn('setup-steps/copy-preserved-files: no resolvedWorktreePath in context — skipping');
    return ok({});
  }

  try {
    const taskFs = makeTaskFs(ctx);
    if (!taskFs) return ok({});

    const settings = await getEffectiveTaskSettings({
      projectSettings: ctx.projectSettings,
      taskFs,
      taskConfigPath: ctx.files.path.join(targetPath, '.emdash.json'),
    });
    const patterns = settings.preservePatterns ?? [];
    const repoFs = ctx.files.fileSystem();
    if (!repoFs.success) {
      log.warn('setup-steps/copy-preserved-files: failed to open repo filesystem', repoFs.error);
      return ok({});
    }

    for (const pattern of patterns) {
      if (!isSafePreservePattern(ctx.files.path, pattern)) {
        log.warn('setup-steps/copy-preserved-files: skipping unsafe preserve pattern', { pattern });
        continue;
      }
      const matches = repoFs.data.glob([pattern], { cwd: ctx.repoPath, dot: true });
      if (!matches.success) {
        log.warn('setup-steps/copy-preserved-files: failed to match preserve pattern', {
          pattern,
          error: matches.error,
        });
        continue;
      }
      for await (const absPath of matches.data) {
        const relPath = preservedRepoRelativePath(ctx.files.path, ctx.repoPath, absPath);
        if (!relPath || (await isTrackedSourcePath(absPath, ctx))) continue;
        const stat = await repoFs.data.stat(absPath);
        if (!stat.success || stat.data.type !== 'file') continue;
        const destPath = preservedDestinationPath(ctx.files.path, targetPath, relPath);
        if (!destPath) continue;
        const copied = await repoFs.data.copyFile(absPath, destPath);
        if (!copied.success) {
          log.warn('setup-steps/copy-preserved-files: failed to copy preserved file', {
            sourcePath: absPath,
            destPath,
            error: copied.error,
          });
        }
      }
    }
  } catch (error: unknown) {
    log.warn('setup-steps/copy-preserved-files: failed to copy preserved files', {
      targetPath,
      error: String(error),
    });
  }

  return ok({});
}
