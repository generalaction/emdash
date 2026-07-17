import path from 'node:path';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { ok, type Result } from '@emdash/shared';
import type * as Step from '@core/primitives/workspaces/api/workspace-setup-steps/copy-preserved-files';
import {
  fileKey,
  fileMutationKey,
  fileRelativePath,
  filesClientScope,
  nativeFilePath,
  runFilesJob,
  singleFileChunk,
} from '@main/core/files/runtime-client';
import { gitFilePath } from '@main/core/git/runtime-client';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import {
  isSafePreservePattern,
  preservedDestinationPath,
  preservedRepoRelativePath,
} from '@main/core/projects/settings/preserve-pattern-safety';
import { isRealPathContained } from '@main/core/runtime/files-helpers';
import { log } from '@main/lib/logger';
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
    const taskFiles = filesClientScope(ctx.files.client, targetPath);
    const settings = await getEffectiveTaskSettings({
      projectSettings: ctx.projectSettings,
      taskFiles,
      taskConfigPath: path.join(targetPath, '.emdash.json'),
    });

    for (const pattern of settings.preservePatterns ?? []) {
      if (!isSafePreservePattern(nativePathOperations, pattern)) {
        log.warn('setup-steps/copy-preserved-files: skipping unsafe preserve pattern', { pattern });
        continue;
      }
      const matches = await runFilesJob(filesContract.fs.glob, ctx.files.client.fs.glob, {
        root: ctx.files.root,
        patterns: [pattern],
        options: { cwd: fileRelativePath(ctx.files, ctx.repoPath), dot: true },
      });
      if (!matches.success) {
        log.warn('setup-steps/copy-preserved-files: failed to match preserve pattern', {
          pattern,
          error: matches.error,
        });
        continue;
      }
      for (const relativePath of matches.data.paths) {
        const absPath = nativeFilePath(ctx.files, relativePath);
        const relPath = preservedRepoRelativePath(nativePathOperations, ctx.repoPath, absPath);
        if (!relPath || (await isTrackedSourcePath(relPath, ctx))) continue;
        const stat = await ctx.files.client.fs.stat(fileKey(ctx.files, absPath));
        if (!stat.success || stat.data.type !== 'file') continue;
        const destPath = preservedDestinationPath(nativePathOperations, targetPath, relPath);
        if (!destPath) continue;
        const contained = await isRealPathContained(targetPath, destPath);
        if (!contained.success || !contained.data) continue;

        const source = await ctx.files.client.fs.readBytes(fileKey(ctx.files, absPath));
        if (!source.success) continue;
        const bytes = await source.data.bytes();
        const copied = await taskFiles.client.fs.upload(
          { ...fileMutationKey(taskFiles, destPath), overwrite: true },
          {
            name: path.basename(destPath),
            mimeType: 'application/octet-stream',
            size: bytes.byteLength,
            source: singleFileChunk(bytes),
          }
        );
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
  const result = await ctx.git.checkout.getFileAtIndex({
    ...ctx.checkout,
    filePath: gitFilePath(relativePath),
  });
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
