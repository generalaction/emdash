import { describe, expect, it } from 'vitest';
import { isIgnored, isIgnoredInsideRoot, isIgnoredRelativePath } from './ignores';

describe('isIgnoredRelativePath', () => {
  it('matches ignored directory segments', () => {
    expect(isIgnoredRelativePath('node_modules/pkg/index.js')).toBe(true);
    expect(isIgnoredRelativePath('.git/HEAD')).toBe(true);
    expect(isIgnoredRelativePath('src/dist/bundle.js')).toBe(true);
  });

  it('does not match ordinary relative paths', () => {
    expect(isIgnoredRelativePath('src/index.ts')).toBe(false);
    expect(isIgnoredRelativePath('README.md')).toBe(false);
    expect(isIgnoredRelativePath('')).toBe(false);
  });

  it('handles Windows separators', () => {
    expect(isIgnoredRelativePath('src\\node_modules\\x.js')).toBe(true);
    expect(isIgnoredRelativePath('src\\index.ts')).toBe(false);
  });
});

describe('isIgnoredInsideRoot', () => {
  // Regression: a checkout living under `/.../worktrees/...` must not have all of
  // its children filtered out just because an ancestor segment is `worktrees`.
  it('ignores only segments strictly below the root', () => {
    const root = '/Users/me/emdash/worktrees/feature';
    expect(isIgnoredInsideRoot(root, `${root}/src/index.ts`)).toBe(false);
    expect(isIgnoredInsideRoot(root, `${root}/README.md`)).toBe(false);
    expect(isIgnoredInsideRoot(root, `${root}/node_modules/pkg/index.js`)).toBe(true);
    expect(isIgnoredInsideRoot(root, `${root}/.git/HEAD`)).toBe(true);
  });

  it('never inspects the root prefix itself', () => {
    const root = '/var/dist/build/project';
    expect(isIgnoredInsideRoot(root, `${root}/src/main.ts`)).toBe(false);
    expect(isIgnoredInsideRoot(root, root)).toBe(false);
  });

  it('treats paths that escape the root as not ignored', () => {
    const root = '/repo';
    expect(isIgnoredInsideRoot(root, '/other/node_modules/x')).toBe(false);
    expect(isIgnoredInsideRoot(root, '/repo-sibling/dist/x')).toBe(false);
  });

  it('falls back to relative-path semantics with an empty root', () => {
    expect(isIgnoredInsideRoot('', 'node_modules/x')).toBe(true);
    expect(isIgnoredInsideRoot('', 'src/x.ts')).toBe(false);
  });
});

describe('isIgnored (relative-only contract)', () => {
  it('matches ignored segments of a relative path', () => {
    expect(isIgnored('node_modules/x')).toBe(true);
    expect(isIgnored('src/x.ts')).toBe(false);
  });
});
