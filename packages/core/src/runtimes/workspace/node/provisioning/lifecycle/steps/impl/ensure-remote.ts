import { ensureRemoteStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { gitFailure } from './helpers';

export const ensureRemoteImpl = implement(ensureRemoteStep, async (args, ctx) => {
  const remoteResult = await runGit(['remote'], { cwd: ctx.repoPath, signal: ctx.signal });
  const existing = remoteResult.success
    ? remoteResult.data.stdout
        .split('\n')
        .map((remote) => remote.trim())
        .filter(Boolean)
    : [];

  const created = !existing.includes(args.name);
  const result = created
    ? await runGit(['remote', 'add', args.name, args.url], {
        cwd: ctx.repoPath,
        signal: ctx.signal,
      })
    : await runGit(['remote', 'set-url', args.name, args.url], {
        cwd: ctx.repoPath,
        signal: ctx.signal,
      });

  if (result.success) return stepOk({ facts: { created } });

  const failure = gitFailure('remote-error', result.error);
  return stepErr(failure.failureClass, failure.error);
});
