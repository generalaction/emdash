import { removeRemoteStep } from '@services/workspace-lifecycle/api/steps/catalog';
import { implement, stepOk } from '@services/workspace-lifecycle/api/steps/implement';
import { runGit } from '@services/workspace-lifecycle/api/steps/run-git';

export const removeRemoteImpl = implement(removeRemoteStep, async (args, ctx) => {
  const remotes = await runGit(['remote'], { cwd: ctx.repoPath, signal: ctx.signal });
  if (
    !remotes.success ||
    !remotes.data.stdout
      .split('\n')
      .map((remote) => remote.trim())
      .includes(args.name)
  ) {
    return stepOk();
  }

  await runGit(['remote', 'remove', args.name], { cwd: ctx.repoPath, signal: ctx.signal });
  return stepOk();
});
