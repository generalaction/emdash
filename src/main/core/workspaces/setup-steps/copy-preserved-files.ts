import type { FileSystemProvider } from '@main/core/fs/types';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { log } from '@main/lib/logger';
import { ok, type Result } from '@shared/result';
import type * as Step from '@shared/workspace-setup-steps/copy-preserved-files';
import type { StepContext } from './step-context';

function makeTaskFs(
  targetPath: string,
  ctx: StepContext
): Pick<FileSystemProvider, 'exists' | 'read'> {
  return {
    exists: (filePath) => ctx.host.existsAbsolute(ctx.host.pathApi.join(targetPath, filePath)),
    read: async (filePath) => {
      const content = await ctx.host.readFileAbsolute(ctx.host.pathApi.join(targetPath, filePath));
      return { content, truncated: false, totalSize: Buffer.byteLength(content) };
    },
  };
}

async function isTrackedSourcePath(relPath: string, ctx: StepContext): Promise<boolean> {
  try {
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
    const settings = await getEffectiveTaskSettings({
      projectSettings: ctx.projectSettings,
      taskFs: makeTaskFs(targetPath, ctx) as unknown as FileSystemProvider,
    });
    const patterns = settings.preservePatterns ?? [];

    for (const pattern of patterns) {
      const matches = await ctx.host.globAbsolute(pattern, {
        cwd: ctx.repoPath,
        dot: true,
      });
      for (const relPath of matches) {
        if (relPath === '.emdash.json' || (await isTrackedSourcePath(relPath, ctx))) continue;
        const src = ctx.host.pathApi.join(ctx.repoPath, relPath);
        const stat = await ctx.host.statAbsolute(src).catch(() => null);
        if (!stat || stat.type !== 'file') continue;
        const dest = ctx.host.pathApi.join(targetPath, relPath);
        await ctx.host.mkdirAbsolute(ctx.host.pathApi.dirname(dest), { recursive: true });
        await ctx.host.copyFileAbsolute(src, dest);
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
