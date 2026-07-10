import { describe, expect, it } from 'vitest';
import * as gitRuntime from './index';

describe('@emdash/runtime/git public exports', () => {
  it('exposes runtime composition and wire implementation factories', () => {
    const exported = gitRuntime as Record<string, unknown>;

    expect(exported.GitRuntime).toBeTypeOf('function');
    expect(exported.createGitContractImpl).toBeTypeOf('function');
    expect(exported.createGitController).toBeTypeOf('function');
    expect(exported.GitSessionManager).toBeTypeOf('function');
    expect(exported.createRepositoryLiveHost).toBeTypeOf('function');
    expect(exported.RepositoryResource).toBeTypeOf('function');
    expect(exported.createCheckoutLiveHost).toBeTypeOf('function');
    expect(exported.CheckoutResource).toBeTypeOf('function');
  });

  it('does not re-export core vocabulary or concrete Git capabilities', () => {
    const exported = gitRuntime as Record<string, unknown>;

    expect(exported.gitContract).toBeUndefined();
    expect(exported.StatusParser).toBeUndefined();
    expect(exported.computeBaseRef).toBeUndefined();
    expect(exported.GitRepository).toBeUndefined();
    expect(exported.GitCheckout).toBeUndefined();
  });
});
