import { describe, expect, it } from 'vitest';
import { compileWorktreePayload } from './compile-worktree-payload';

describe('compileWorktreePayload', () => {
  it.each([
    {
      repoPath: '/Users/test/code/emdash',
      worktreeRoot: '/Users/test/emdash/worktrees',
      branchName: 'feature/compiler',
      legacyPath: '/Users/test/emdash/worktrees/emdash-6190d212/feature-compiler',
    },
    {
      repoPath: '/srv/repos/my repo',
      worktreeRoot: '/srv/worktrees',
      branchName: 'feature/über long branch',
      legacyPath: '/srv/worktrees/my repo-f7826658/feature--ber-long-branch',
    },
    {
      repoPath: '/srv/repos/répo',
      worktreeRoot: '/srv/worktrees',
      branchName: 'feature',
      legacyPath: '/srv/worktrees/répo-8c4df4f6/feature',
    },
    {
      repoPath:
        '/Users/test/code/very-long-repository-name-very-long-repository-name-' +
        'very-long-repository-name-very-long-repository-name-',
      worktreeRoot: '/worktrees',
      branchName: 'feature',
      legacyPath:
        '/worktrees/very-long-repository-name-very-long-repository-name-' +
        'very-long-repository-name-very-long-repository-name--dec769ef/feature',
    },
  ])('matches the legacy path compiler for $branchName', (input) => {
    expect(compileWorktreePayload(input)).toEqual({
      worktreePath: input.legacyPath,
      branchName: input.branchName,
      preservePatterns: [],
    });
  });

  it('uses Windows separators for Windows roots', () => {
    const result = compileWorktreePayload({
      repoPath: String.raw`C:\Users\test\code\emdash`,
      worktreeRoot: String.raw`C:\Users\test\emdash\worktrees`,
      branchName: 'fix/windows/path',
    });

    expect(result.worktreePath).toMatch(
      /^C:\\Users\\test\\emdash\\worktrees\\emdash-[a-f0-9]{8}\\fix-windows-path$/u
    );
  });

  it('copies preserve patterns into the payload', () => {
    const preservePatterns = ['.env', 'local/**'];
    const result = compileWorktreePayload({
      repoPath: '/repo/app',
      worktreeRoot: '/worktrees',
      branchName: 'feature',
      preservePatterns,
    });

    expect(result.preservePatterns).toEqual(preservePatterns);
    expect(result.preservePatterns).not.toBe(preservePatterns);
  });

  it.each([
    ['.', 'branch'],
    ['..', 'branch'],
  ])('keeps special POSIX branch names inside the worktree pool: %s', (branchName, segment) => {
    const result = compileWorktreePayload({
      repoPath: '/repo/app',
      worktreeRoot: '/worktrees',
      branchName,
    });

    expect(result.worktreePath).toMatch(new RegExp(`/${segment.replace('.', '\\.')}$`, 'u'));
  });

  it.each([
    ['.', 'branch'],
    ['..', 'branch'],
    ['CON', '_CON'],
    ['com1.txt', '_com1.txt'],
    ['feature...   ', 'feature'],
    ['feature///windows', 'feature-windows'],
    ['修复-windows', '修复-windows'],
  ])('generates a legal Windows branch segment for %s', (branchName, segment) => {
    const result = compileWorktreePayload({
      repoPath: String.raw`C:\Code\app`,
      worktreeRoot: String.raw`C:\worktrees`,
      branchName,
    });

    expect(result.worktreePath.endsWith(`\\${segment}`)).toBe(true);
  });

  it('uses one Windows pool for casing and separator variants of the same repository', () => {
    const first = compileWorktreePayload({
      repoPath: String.raw`C:\Code\App`,
      worktreeRoot: String.raw`C:\worktrees`,
      branchName: 'one',
    });
    const second = compileWorktreePayload({
      repoPath: 'c:/code/app',
      worktreeRoot: String.raw`C:\worktrees`,
      branchName: 'two',
    });

    expect(first.worktreePath.slice(0, first.worktreePath.lastIndexOf('\\'))).toBe(
      second.worktreePath.slice(0, second.worktreePath.lastIndexOf('\\'))
    );
  });

  it('shortens generated Windows segments below the path budget', () => {
    const result = compileWorktreePayload({
      repoPath: `C:\\Code\\${'repository'.repeat(20)}`,
      worktreeRoot: String.raw`C:\worktrees`,
      branchName: 'feature-'.repeat(30),
    });

    expect(result.worktreePath.length).toBeLessThanOrEqual(220);
    expect(result.worktreePath).toMatch(/-[a-f0-9]{8}\\.*-[a-f0-9]{8}$/u);
  });

  it('reports how to fix a Windows root that leaves no generated-path budget', () => {
    expect(() =>
      compileWorktreePayload({
        repoPath: String.raw`C:\Code\app`,
        worktreeRoot: `C:\\${'deep\\'.repeat(60)}`,
        branchName: 'feature',
      })
    ).toThrow(/shorter worktree root or enable Git core\.longpaths/u);
  });
});
