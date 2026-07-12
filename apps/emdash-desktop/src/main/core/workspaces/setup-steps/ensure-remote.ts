import { err, ok, type Result } from '@emdash/shared';
import { gitErrorMessage } from '@main/core/git/runtime-git';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/ensure-remote';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { name, url } = args;
  const remotes = await ctx.gitRepository.getRemotes();
  const current = remotes.remotes.find((remote) => remote.name === name);
  const result = current
    ? current.url === url
      ? ok()
      : await ctx.gitRepository.setRemoteUrl(name, url)
    : await ctx.gitRepository.addRemote(name, url);
  return result.success
    ? ok({})
    : err({ type: 'remote-error', name, message: gitErrorMessage(result.error) });
}
