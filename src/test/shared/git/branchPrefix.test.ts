import { describe, expect, it } from 'vitest';
import { extractSlugType, buildBranchName } from '../../../shared/git/branchPrefix';

describe('extractSlugType', () => {
  it('extracts "fix" from a fix-prefixed slug', () => {
    expect(extractSlugType('fix-login-page')).toEqual({ type: 'fix', rest: 'login-page' });
  });

  it('extracts "feat" from a feat-prefixed slug', () => {
    expect(extractSlugType('feat-user-auth')).toEqual({ type: 'feat', rest: 'user-auth' });
  });

  it('extracts "refactor" from a refactor-prefixed slug', () => {
    expect(extractSlugType('refactor-utils')).toEqual({ type: 'refactor', rest: 'utils' });
  });

  it('extracts "chore" from a chore-prefixed slug', () => {
    expect(extractSlugType('chore-deps')).toEqual({ type: 'chore', rest: 'deps' });
  });

  it('extracts "test" from a test-prefixed slug', () => {
    expect(extractSlugType('test-auth')).toEqual({ type: 'test', rest: 'auth' });
  });

  it('extracts "perf" from a perf-prefixed slug', () => {
    expect(extractSlugType('perf-query')).toEqual({ type: 'perf', rest: 'query' });
  });

  it('extracts "docs" from a docs-prefixed slug', () => {
    expect(extractSlugType('docs-readme')).toEqual({ type: 'docs', rest: 'readme' });
  });

  it('extracts "style" from a style-prefixed slug', () => {
    expect(extractSlugType('style-button')).toEqual({ type: 'style', rest: 'button' });
  });

  it('extracts "ci" from a ci-prefixed slug', () => {
    expect(extractSlugType('ci-pipeline')).toEqual({ type: 'ci', rest: 'pipeline' });
  });

  it('extracts "build" from a build-prefixed slug', () => {
    expect(extractSlugType('build-docker')).toEqual({ type: 'build', rest: 'docker' });
  });

  it('extracts "revert" from a revert-prefixed slug', () => {
    expect(extractSlugType('revert-commit')).toEqual({ type: 'revert', rest: 'commit' });
  });

  it('returns null type for slug with no known type prefix', () => {
    expect(extractSlugType('login-page')).toEqual({ type: null, rest: 'login-page' });
  });

  it('returns null type for slug that is only a type with no rest', () => {
    expect(extractSlugType('fix')).toEqual({ type: null, rest: 'fix' });
  });

  it('returns null type for empty string', () => {
    expect(extractSlugType('')).toEqual({ type: null, rest: '' });
  });
});

describe('buildBranchName', () => {
  it('uses custom prefix when provided', () => {
    expect(buildBranchName('emdash', 'fix-login-page', 'a3f')).toBe('emdash/fix-login-page-a3f');
  });

  it('uses type as prefix when branchPrefix is empty and type is detected', () => {
    expect(buildBranchName('', 'fix-login-page', 'a3f')).toBe('fix/login-page-a3f');
  });

  it('omits prefix entirely when branchPrefix is empty and no type detected', () => {
    expect(buildBranchName('', 'login-page', 'a3f')).toBe('login-page-a3f');
  });

  it('works with feat type', () => {
    expect(buildBranchName('', 'feat-user-auth', 'b2c')).toBe('feat/user-auth-b2c');
  });

  it('does not extract type when custom prefix is set', () => {
    expect(buildBranchName('myprefix', 'feat-user-auth', 'b2c')).toBe(
      'myprefix/feat-user-auth-b2c'
    );
  });

  it('omits hash suffix when hash is empty with custom prefix', () => {
    expect(buildBranchName('emdash', 'fix-login-page', '')).toBe('emdash/fix-login-page');
  });

  it('omits hash suffix when hash is empty with type prefix', () => {
    expect(buildBranchName('', 'feat-user-auth', '')).toBe('feat/user-auth');
  });

  it('omits hash suffix when hash is empty with no prefix', () => {
    expect(buildBranchName('', 'login-page', '')).toBe('login-page');
  });
});
