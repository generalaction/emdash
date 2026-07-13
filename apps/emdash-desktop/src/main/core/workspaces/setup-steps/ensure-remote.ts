import { err, ok, type Result } from '@emdash/shared';
import { gitErrorMessage, mutationResult } from '@main/core/git/runtime-client';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/ensure-remote';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { name, url } = args;
  const remotes = (await ctx.git.repository.model.state(ctx.repository, 'remotes').snapshot()).data;
  const current = remotes.remotes.find((remote) => remote.name === name);
  const result = current
    ? current.url === url
      ? ok()
      : await mutationResult(
          ctx.git.repository.model.mutate('setRemoteUrl', {
            key: ctx.repository,
            input: { name, url },
          })
        )
    : await mutationResult(
        ctx.git.repository.model.mutate('addRemote', {
          key: ctx.repository,
          input: { name, url },
        })
      );
  return result.success
    ? ok({})
    : err({ type: 'remote-error', name, message: gitErrorMessage(result.error) });
}
