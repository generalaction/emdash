import type { CheckoutKey, GitCommandError } from '@emdash/core/git';
import { type Result } from '@emdash/shared';
import { type LiveModelHostMutationHandlers, type LiveModelMutationCtx } from '@emdash/wire';
import type { CheckoutModel } from './live-models';
import type { CheckoutResource } from './resource';

type CheckoutMutationCtx = LiveModelMutationCtx<CheckoutModel>;

export type RequireCheckoutSession = (
  key: CheckoutKey
) => Result<CheckoutResource, GitCommandError>;

export function createCheckoutMutationHandlers(
  requireSession: RequireCheckoutSession
): LiveModelHostMutationHandlers<CheckoutModel> {
  return {
    stage: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () => resource.checkout.stage(input.paths))
      ),
    unstage: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () => resource.checkout.unstage(input.paths))
      ),
    stageAll: (ctx) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () => resource.checkout.stageAll())
      ),
    unstageAll: (ctx) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () => resource.checkout.unstageAll())
      ),
    revert: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () => resource.checkout.revert(input.paths))
      ),
    revertAll: (ctx) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () => resource.checkout.revertAll())
      ),
    clean: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () =>
          resource.checkout.clean({ paths: input.paths, force: input.force })
        )
      ),
    stageHunk: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () =>
          resource.checkout.stageHunk(input.path, input.hunkHeader)
        )
      ),
    unstageHunk: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () =>
          resource.checkout.unstageHunk(input.path, input.hunkHeader)
        )
      ),
    discardHunk: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStatusAfter(ctx, resource, () =>
          resource.checkout.discardHunk(input.path, input.hunkHeader)
        )
      ),
    commit: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) => {
        const result = await resource.checkout.commit(input.message, input.options);
        if (!result.success) return result;
        await refreshHistory(resource, ctx);
        return result;
      }),
    switch: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.switch(input.options))
      ),
    reset: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.reset(input.ref, input.mode))
      ),
    merge: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.merge(input.options))
      ),
    mergeContinue: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.mergeContinue(input.message))
      ),
    mergeAbort: (ctx) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.mergeAbort())
      ),
    rebase: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.rebase(input.options))
      ),
    rebaseContinue: (ctx) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.rebaseContinue())
      ),
    rebaseAbort: (ctx) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.rebaseAbort())
      ),
    rebaseSkip: (ctx) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () => resource.checkout.rebaseSkip())
      ),
    cherryPick: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () =>
          resource.checkout.cherryPick(input.commits, input.noCommit)
        )
      ),
    revertCommit: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshHistoryAfter(ctx, resource, () =>
          resource.checkout.revertCommit(input.commit, input.noCommit)
        )
      ),
    stashPush: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStashAfter(ctx, resource, () => resource.checkout.stashPush(input.options))
      ),
    stashApply: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStashAfter(ctx, resource, () => resource.checkout.stashApply(input.stashIndex))
      ),
    stashPop: (ctx, input) =>
      withCheckoutMutation(requireSession(ctx.key as CheckoutKey), async (resource) =>
        refreshStashAfter(ctx, resource, () => resource.checkout.stashPop(input.stashIndex))
      ),
  };
}

export function withCheckoutMutation<T, E>(
  session: Result<CheckoutResource, GitCommandError>,
  run: (resource: CheckoutResource) => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  if (!session.success) return Promise.resolve(session as Result<T, E>);
  return session.data.runMutation(() => run(session.data));
}

async function refreshStatusAfter<T, E>(
  ctx: CheckoutMutationCtx,
  resource: CheckoutResource,
  run: () => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  const result = await run();
  if (!result.success) return result;
  await resource.refreshStatus(ctx);
  resource.bumpAllDiffStates('index-changed');
  return result;
}

async function refreshHistoryAfter<T, E>(
  ctx: CheckoutMutationCtx,
  resource: CheckoutResource,
  run: () => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  const result = await run();
  if (!result.success) {
    await Promise.all([resource.refreshStatus(ctx), resource.refreshHead(ctx)]);
    resource.bumpAllDiffStates('ref-changed');
    return result;
  }
  await refreshHistory(resource, ctx);
  return result;
}

async function refreshHistory(resource: CheckoutResource, ctx: CheckoutMutationCtx): Promise<void> {
  await Promise.all([
    resource.refreshStatus(ctx),
    resource.refreshHead(ctx),
    resource.repository.refreshRefs(),
  ]);
  resource.bumpAllDiffStates('ref-changed');
}

async function refreshStashAfter<T, E>(
  ctx: CheckoutMutationCtx,
  resource: CheckoutResource,
  run: () => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  const result = await run();
  if (!result.success) return result;
  await Promise.all([resource.refreshStatus(ctx), resource.repository.refreshStashes()]);
  resource.bumpAllDiffStates('index-changed');
  return result;
}
