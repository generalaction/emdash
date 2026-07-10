import { describe, expect, it } from 'vitest';
import * as gitRuntime from './index';

describe('@emdash/runtime/git public exports', () => {
  it('exposes runtime composition and wire implementation factories', () => {
    const exported = gitRuntime as Record<string, unknown>;

    expect(exported.GitRuntime).toBeTypeOf('function');
    expect(exported.createGitContractImpl).toBeTypeOf('function');
    expect(exported.createGitController).toBeTypeOf('function');
    expect(exported.GitWireAdapter).toBeTypeOf('function');
    expect(exported.GitAllocationGraph).toBeTypeOf('function');
    expect(exported.RepositoryMount).toBeTypeOf('function');
    expect(exported.CheckoutMount).toBeTypeOf('function');
  });

  it('exports host execution capabilities without re-exporting core contracts', () => {
    const exported = gitRuntime as Record<string, unknown>;

    expect(exported.gitContract).toBeUndefined();
    expect(exported.StatusParser).toBeUndefined();
    expect(exported.computeBaseRef).toBeUndefined();
    expect(exported.GitRepository).toBeTypeOf('function');
    expect(exported.GitCheckout).toBeTypeOf('function');
    expect(exported.GitRepositoryProvisioner).toBeTypeOf('function');
    expect(exported.GitSessionManager).toBeUndefined();
    expect(exported.createRepositoryLiveHost).toBeUndefined();
  });
});
