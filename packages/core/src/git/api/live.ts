import { z } from 'zod';
import { createLiveModelContract } from '../../live';
import { gitHeadModelSchema } from '../checkout/models/head';
import { checkoutStatusModelSchema } from '../checkout/models/status';
import { gitRefsModelSchema } from '../repository/models/refs';
import { gitRemotesModelSchema } from '../repository/models/remotes';
import { gitStashesModelSchema } from '../repository/models/stashes';

export const gitRepositoryInputSchema = z.object({ repositoryRoot: z.string() });
export const gitCheckoutInputSchema = z.object({ checkoutPath: z.string() });

export const gitLiveContract = {
  repository: {
    /** Branches, tags — shared across all checkouts. */
    refs: createLiveModelContract(gitRefsModelSchema, {
      snapshotInput: gitRepositoryInputSchema,
      subscribeInput: gitRepositoryInputSchema,
      unsubscribeInput: gitRepositoryInputSchema,
    }),

    /** Configured remotes for this repository. */
    remotes: createLiveModelContract(gitRemotesModelSchema, {
      snapshotInput: gitRepositoryInputSchema,
      subscribeInput: gitRepositoryInputSchema,
      unsubscribeInput: gitRepositoryInputSchema,
    }),

    /** Stash list — owned by the repository, not a specific checkout. */
    stashes: createLiveModelContract(gitStashesModelSchema, {
      snapshotInput: gitRepositoryInputSchema,
      subscribeInput: gitRepositoryInputSchema,
      unsubscribeInput: gitRepositoryInputSchema,
    }),
  },
  checkout: {
    /** Normalized working-tree status (staged + unstaged, flat map by path). */
    status: createLiveModelContract(checkoutStatusModelSchema, {
      snapshotInput: gitCheckoutInputSchema,
      subscribeInput: gitCheckoutInputSchema,
      unsubscribeInput: gitCheckoutInputSchema,
    }),

    /** Current HEAD position (branch / detached / unborn). */
    head: createLiveModelContract(gitHeadModelSchema, {
      snapshotInput: gitCheckoutInputSchema,
      subscribeInput: gitCheckoutInputSchema,
      unsubscribeInput: gitCheckoutInputSchema,
    }),
  },
};
