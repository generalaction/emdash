import { createLocalBranchStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
  stepWarning,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import {
  gitErrorMessage,
  runGit,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { gitFailure } from './helpers';

export const createLocalBranchImpl = implement(createLocalBranchStep, async (args, ctx) => {
  const existing = await runGit(['rev-parse', '--verify', `refs/heads/${args.branchName}`], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });

  if (existing.success) {
    const fromHead = await runGit(['rev-parse', '--verify', args.fromRef], {
      cwd: ctx.repoPath,
      signal: ctx.signal,
    });
    if (fromHead.success && existing.data.stdout.trim() === fromHead.data.stdout.trim()) {
      return stepOk({ facts: { created: false } });
    }

    if (args.reset) {
      const reset = await runGit(['branch', '--force', args.branchName, args.fromRef], {
        cwd: ctx.repoPath,
        signal: ctx.signal,
      });
      if (reset.success) return stepOk({ facts: { created: false } });
      const failure = gitFailure('create-failed', reset.error);
      return stepErr(failure.failureClass, failure.error);
    }

    return stepErr('conflict', {
      type: 'branch-exists-diverged',
      message: `Branch "${args.branchName}" exists and does not point at ${args.fromRef}`,
      resolutions: ['use-existing', 'recreate', 'rename'],
    });
  }

  const gitArgs = ['branch'];
  if (args.noTrack) gitArgs.push('--no-track');
  gitArgs.push(args.branchName, args.fromRef);

  const result = await runGit(gitArgs, { cwd: ctx.repoPath, signal: ctx.signal });
  if (result.success) {
    const marker = await runGit(['config', `branch.${args.branchName}.emdash-created`, 'true'], {
      cwd: ctx.repoPath,
      signal: ctx.signal,
    });
    return stepOk({
      facts: { created: true },
      warnings: marker.success
        ? undefined
        : [
            stepWarning(
              'ownership-marker-failed',
              `Created branch "${args.branchName}" but could not record Emdash ownership`
            ),
          ],
    });
  }

  const message = gitErrorMessage(result.error);
  if (
    message.includes('not a valid object name') ||
    message.includes('unknown revision') ||
    message.includes('invalid reference')
  ) {
    return stepErr('permanent', {
      type: 'ref-not-found',
      message: `Reference "${args.fromRef}" was not found`,
    });
  }

  const failure = gitFailure('create-failed', result.error);
  return stepErr(failure.failureClass, failure.error);
});
