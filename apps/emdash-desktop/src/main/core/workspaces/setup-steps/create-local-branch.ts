import { err, ok, type Result } from '@emdash/shared';
import { gitErrorMessage, mutationResult } from '@main/core/git/runtime-client';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/create-local-branch';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { branchName, fromRef, noTrack } = args;
  const refs = (await ctx.git.repository.model.state(ctx.repository, 'refs').snapshot()).data;
  if (refs.branches.some((branch) => branch.type === 'local' && branch.branch === branchName)) {
    return ok({});
  }

  const created = await mutationResult(
    ctx.git.repository.model.mutate('createBranch', {
      key: ctx.repository,
      input: {
        options: {
          name: branchName,
          from: fromRef,
          syncWithRemote: !noTrack && fromRef.includes('/'),
          remote: !noTrack ? fromRef.split('/')[0] : undefined,
        },
      },
    })
  );
  if (created.success) return ok({});
  if (created.error.type === 'already_exists') return ok({});
  if (created.error.type === 'invalid_base') return err({ type: 'ref-not-found', ref: fromRef });
  return err({
    type: 'create-failed',
    branchName,
    message: gitErrorMessage(created.error),
  });
}
