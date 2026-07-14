import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { gitCloneStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import {
  gitErrorMessage,
  runGit,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { runGitStreaming } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git-streaming';
import { gitFailure } from './helpers';

export const gitCloneImpl = implement(gitCloneStep, async (args, ctx) => {
  const existing = await stat(args.path).catch(() => undefined);
  if (existing) {
    if (!existing.isDirectory()) {
      return stepErr('conflict', {
        type: 'path-exists',
        message: `Path "${args.path}" exists and is not a directory`,
        resolutions: ['choose-another-path'],
      });
    }

    const remote = await runGit(['remote', 'get-url', args.remoteName ?? 'origin'], {
      cwd: args.path,
      signal: ctx.signal,
    });
    if (remote.success && remote.data.stdout.trim() === args.url) {
      return stepOk({ facts: { created: false, path: args.path } });
    }

    return stepErr('conflict', {
      type: 'clone-destination-exists',
      message: `Path "${args.path}" already exists and is not a clone of ${args.url}`,
      resolutions: ['choose-another-path', 'use-existing'],
    });
  }

  await mkdir(path.dirname(args.path), { recursive: true });
  const gitArgs = ['-c', 'checkout.workers=0', 'clone', '--progress'];
  if (args.noTags) gitArgs.push('--no-tags');
  if (args.filter === 'blob:none') gitArgs.push('--filter=blob:none');
  if (args.depth) gitArgs.push('--depth', String(args.depth));
  if (args.remoteName) gitArgs.push('--origin', args.remoteName);
  gitArgs.push(args.url, args.path);

  const result = await runGitStreaming(gitArgs, {
    cwd: path.dirname(args.path),
    signal: ctx.signal,
    onOutput: ctx.emitOutput,
    onProgress: ctx.reportProgress,
  });
  if (result.success) return stepOk({ facts: { created: true, path: args.path } });

  const failure = gitFailure('clone-failed', {
    ...result.error,
    message: gitErrorMessage(result.error),
  });
  return stepErr(failure.failureClass, failure.error);
});
