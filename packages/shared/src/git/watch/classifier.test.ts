import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyGitWatchEvents } from './classifier';

describe('classifyGitWatchEvents', () => {
  it('treats config changes as refs and remotes staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');

    const classification = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'config') }],
      { gitCommonDir, worktrees: [] }
    );

    expect(classification.repo).toEqual({ refs: true, remotes: true });
  });

  it('ignores object database writes for repo facts', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');

    const classification = classifyGitWatchEvents(
      [{ kind: 'create', path: path.join(gitCommonDir, 'objects', 'aa', 'bbbb') }],
      { gitCommonDir, worktrees: [] }
    );

    expect(classification.repo).toEqual({ refs: false, remotes: false });
  });

  it('treats branch ref changes as worktree head and status staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');

    const classification = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'refs', 'heads', 'main') }],
      { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] }
    );

    expect(classification.repo).toEqual({ refs: true, remotes: false });
    expect(classification.worktrees.get('main')).toEqual({ status: true, head: true });
  });

  it('treats direct HEAD changes as status staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');

    const classification = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'HEAD') }],
      { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] }
    );

    expect(classification.worktrees.get('main')).toEqual({ status: true, head: true });
  });
});
