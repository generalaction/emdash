import { describe, expect, it } from 'vitest';
import * as git from './index';

describe('@emdash/core/git public exports', () => {
  it('exposes the wire contract and controller factory', () => {
    const exported = git as Record<string, unknown>;

    expect(exported.GitRuntime).toBeTypeOf('function');
    expect(exported.createGitController).toBeTypeOf('function');
    expect(exported.gitContract).toBeTypeOf('object');
    expect(exported.gitRepositoryContract).toBeTypeOf('object');
    expect(exported.gitCheckoutContract).toBeTypeOf('object');
  });

  it('does not export concrete repository or checkout classes or the removed oRPC surface', () => {
    const exported = git as Record<string, unknown>;

    expect(exported.GitRepository).toBeUndefined();
    expect(exported.GitCheckout).toBeUndefined();
    expect(exported.gitRouter).toBeUndefined();
    expect(exported.serveGitPort).toBeUndefined();
    expect(exported.createGitSessionJobs).toBeUndefined();
  });
});
