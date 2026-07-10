import { describe, expect, it } from 'vitest';
import type { CheckoutId, RepositoryId } from '../identity/types';
import { effectPlanFor } from './effect-policy';

const repositoryId = '/repo/.git' as RepositoryId;
const checkoutId = '["/repo","/repo/.git"]' as CheckoutId;

describe('effectPlanFor', () => {
  it('settles only staging status mutations', () => {
    const stage = effectPlanFor(
      'stage',
      { repositoryId, checkoutId, paths: ['src/a.ts'] },
      'success'
    );
    const commit = effectPlanFor('commit', { repositoryId, checkoutId }, 'success');

    expect(stage.settle).toEqual([{ kind: 'checkout-status', checkoutId }]);
    expect(stage.eager).toEqual([{ kind: 'file-diff', checkoutId, paths: ['src/a.ts'] }]);
    expect(commit.settle).toEqual([]);
    expect(commit.eager.map((effect) => effect.kind)).toEqual([
      'checkout-status',
      'checkout-head',
      'file-diff',
    ]);
  });

  it('makes cross-domain effects background work', () => {
    const checkout = effectPlanFor('stashPush', { repositoryId, checkoutId }, 'success');
    const repository = effectPlanFor(
      'createBranch',
      { repositoryId, activeCheckoutIds: [checkoutId] },
      'success'
    );

    expect(checkout.background).toEqual([{ kind: 'repository-stashes', repositoryId }]);
    expect(repository.eager).toEqual([{ kind: 'repository-refs', repositoryId }]);
    expect(repository.background.map((effect) => effect.kind)).toEqual([
      'checkout-status',
      'checkout-head',
    ]);
  });

  it('reconciles conflict-prone failures without returning settlement', () => {
    const failed = effectPlanFor('merge', { repositoryId, checkoutId }, 'failure');

    expect(failed.settle).toEqual([]);
    expect(failed.eager.map((effect) => effect.kind)).toEqual([
      'checkout-status',
      'checkout-head',
      'file-diff',
    ]);
  });
});
