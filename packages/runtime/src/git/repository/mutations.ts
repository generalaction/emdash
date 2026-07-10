import type { GitCommandError, RepositoryKey } from '@emdash/core/git';
import { type Result } from '@emdash/shared';
import { type LiveModelHostMutationHandlers } from '@emdash/wire';
import type { RepositoryModel } from './live-models';
import type { RepositoryResource } from './resource';

export type RequireRepositorySession = (
  key: RepositoryKey
) => Result<RepositoryResource, GitCommandError>;

export function createRepositoryMutationHandlers(
  requireSession: RequireRepositorySession
): LiveModelHostMutationHandlers<RepositoryModel> {
  return {
    createBranch: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.createBranch(input.options);
        if (!result.success) return result;
        await resource.refreshRefs(ctx);
        return result;
      }),
    deleteBranch: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.deleteBranch(input.branch, input.force);
        if (!result.success) return result;
        await resource.refreshRefs(ctx);
        return result;
      }),
    renameBranch: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.renameBranch(input.oldName, input.newName);
        if (!result.success) return result;
        await resource.refreshRefs(ctx);
        return result;
      }),
    setUpstream: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.setUpstream(input.branch, input.upstream);
        if (!result.success) return result;
        await resource.refreshRefs(ctx);
        return result;
      }),
    createTag: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.createTag(input.options);
        if (!result.success) return result;
        await resource.refreshRefs(ctx);
        return result;
      }),
    deleteTag: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.deleteTag(input.name);
        if (!result.success) return result;
        await resource.refreshRefs(ctx);
        return result;
      }),
    addRemote: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.addRemote(input.name, input.url);
        if (!result.success) return result;
        await Promise.all([resource.refreshRemotes(ctx), resource.refreshRefs(ctx)]);
        return result;
      }),
    removeRemote: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.removeRemote(input.name);
        if (!result.success) return result;
        await Promise.all([resource.refreshRemotes(ctx), resource.refreshRefs(ctx)]);
        return result;
      }),
    stashDrop: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.stashDrop(input.stashIndex);
        if (!result.success) return result;
        await resource.refreshStashes(ctx);
        return result;
      }),
    addCheckout: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.addCheckout(input.options);
        if (!result.success) return result;
        await Promise.all([
          resource.refreshCheckouts(ctx),
          input.options.newBranch ? resource.refreshRefs(ctx) : Promise.resolve(),
        ]);
        return result;
      }),
    removeCheckout: (ctx, input) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.removeCheckout(input.checkoutPath, input.force);
        if (!result.success) return result;
        await resource.refreshCheckouts(ctx);
        return result;
      }),
    pruneCheckouts: (ctx) =>
      withRepositoryMutation(requireSession(ctx.key as RepositoryKey), async (resource) => {
        const result = await resource.repository.pruneCheckouts();
        if (!result.success) return result;
        await resource.refreshCheckouts(ctx);
        return result;
      }),
  };
}

export function withRepositoryMutation<T, E>(
  session: Result<RepositoryResource, GitCommandError>,
  run: (resource: RepositoryResource) => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  if (!session.success) return Promise.resolve(session as Result<T, E>);
  return session.data.runMutation(() => run(session.data));
}
