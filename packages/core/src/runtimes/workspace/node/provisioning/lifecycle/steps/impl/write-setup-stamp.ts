import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writeSetupStampStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import {
  gitErrorMessage,
  runGit,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';

export type SetupStamp = {
  configHash: string;
  at: string;
};

export const SETUP_STAMP_RELATIVE_PATH = path.join('emdash', 'setup-stamp');
export const DIRECTORY_SETUP_STAMP_RELATIVE_PATH = path.join('.emdash', 'setup-stamp');

type ResolveGitDirResult =
  | { success: true; data: string }
  | {
      success: false;
      class: 'permanent';
      error: {
        type: string;
        message: string;
      };
    };

export const writeSetupStampImpl = implement(writeSetupStampStep, async (args, ctx) => {
  const worktreePath = ctx.resolvedWorktreePath;
  if (!worktreePath) {
    return stepErr('permanent', {
      type: 'missing-worktree',
      message: 'Cannot write setup stamp before a worktree path has been resolved',
    });
  }

  const gitDir = await resolveGitDir(worktreePath, ctx.signal);
  const stampPath = gitDir.success
    ? path.join(gitDir.data, SETUP_STAMP_RELATIVE_PATH)
    : path.join(worktreePath, DIRECTORY_SETUP_STAMP_RELATIVE_PATH);
  try {
    await mkdir(path.dirname(stampPath), { recursive: true });
    await writeFile(
      stampPath,
      JSON.stringify({
        configHash: args.configHash,
        at: new Date().toISOString(),
      } satisfies SetupStamp)
    );
    return stepOk();
  } catch (error) {
    return stepErr('permanent', {
      type: 'setup-stamp-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export async function resolveGitDir(
  worktreePath: string,
  signal?: AbortSignal
): Promise<ResolveGitDirResult> {
  const result = await runGit(['rev-parse', '--git-dir'], { cwd: worktreePath, signal });
  if (!result.success) {
    return {
      success: false,
      class: 'permanent',
      error: {
        type: 'git-dir-failed',
        message: gitErrorMessage(result.error),
      },
    };
  }

  const gitDir = result.data.stdout.trim();
  return {
    success: true,
    data: path.isAbsolute(gitDir) ? gitDir : path.resolve(worktreePath, gitDir),
  };
}
