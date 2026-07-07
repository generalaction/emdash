import { implement } from '@orpc/server';
import type { IGitCheckout } from '../checkout/types';
import type { IGitRepository } from '../repository/types';
import type { IGitRuntime } from '../types';
import { gitContract } from './contract';
import type { GitResourceCache } from './resources';

export type GitApiContext = {
  runtime: IGitRuntime;
  resources: GitResourceCache;
};

export const i = implement(gitContract).$context<GitApiContext>();

type RepositoryInput = { repositoryRoot: string };
type CheckoutInput = { checkoutPath: string };

export const withRepository = i.middleware<{ repository: IGitRepository }, RepositoryInput>(
  async ({ context, next }, input) => {
    const repository = await context.resources.repository(input.repositoryRoot);
    return next({ context: { repository } });
  }
);

export const withCheckout = i.middleware<{ checkout: IGitCheckout }, CheckoutInput>(
  async ({ context, next }, input) => {
    const checkout = await context.resources.checkout(input.checkoutPath);
    return next({ context: { checkout } });
  }
);
