import { describe, expect, it } from 'vitest';
import * as gitRuntime from './index';

describe('@emdash/core/runtimes/git/node public exports', () => {
  it('exposes only runtime and transport composition', () => {
    expect(Object.keys(gitRuntime).sort()).toEqual([
      'GitRuntime',
      'createGitController',
      'createGitProcedures',
    ]);
  });
});
