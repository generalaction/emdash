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
});
