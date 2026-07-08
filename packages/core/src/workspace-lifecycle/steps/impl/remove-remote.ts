import { removeRemoteStep } from '../catalog';
import { implement, stepOk } from '../implement';
import { runGit } from '../run-git';

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
