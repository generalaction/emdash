import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyGitWatchEvents } from './watch-classifier';

describe('classifyGitWatchEvents', () => {
  it('treats config changes as repository and checkout tracking staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');

    const classification = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'config') }],
      { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] }
    );

    expect(classification.repo).toEqual({
      refs: true,
      remotes: true,
    });
    expect(classification.worktrees.get('main')).toEqual({ status: false, head: true });
  });

  it('ignores object database writes for repo facts', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');

    const classification = classifyGitWatchEvents(
      [{ kind: 'create', path: path.join(gitCommonDir, 'objects', 'aa', 'bbbb') }],
      { gitCommonDir, worktrees: [] }
    );

    expect(classification.repo).toEqual({
      refs: false,
      remotes: false,
    });
  });

  it('treats branch ref changes as worktree head and status staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');

    const classification = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'refs', 'heads', 'main') }],
      { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] }
    );

    expect(classification.repo).toEqual({
      refs: true,
      remotes: false,
    });
    expect(classification.worktrees.get('main')).toEqual({ status: true, head: true });
  });

  it('treats packed refs as worktree head and status staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');

    const classification = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'packed-refs') }],
      { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] }
    );

    expect(classification.repo).toEqual({
      refs: true,
      remotes: false,
    });
    expect(classification.worktrees.get('main')).toEqual({ status: true, head: true });
  });

  it('treats remote tracking ref changes as checkout tracking staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');

    const classification = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'refs', 'remotes', 'origin', 'main') }],
      { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] }
    );

    expect(classification.repo.refs).toBe(true);
    expect(classification.worktrees.get('main')).toEqual({ status: false, head: true });
  });

  it('treats a new ref namespace directory as a ref change inside it', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');
    const layout = { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] };

    // inotify reports the directory a first fetch creates, not always the refs written into it.
    const remotes = classifyGitWatchEvents(
      [{ kind: 'create', path: path.join(gitCommonDir, 'refs', 'remotes') }],
      layout
    );
    expect(remotes.repo.refs).toBe(true);
    expect(remotes.worktrees.get('main')).toEqual({ status: false, head: true });

    const tags = classifyGitWatchEvents(
      [{ kind: 'create', path: path.join(gitCommonDir, 'refs', 'tags') }],
      layout
    );
    expect(tags.repo.refs).toBe(true);

    const heads = classifyGitWatchEvents(
      [{ kind: 'create', path: path.join(gitCommonDir, 'refs', 'heads') }],
      layout
    );
    expect(heads.worktrees.get('main')).toEqual({ status: true, head: true });
  });

  it('does not treat reflog writes as worktree head or status staleness', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktree = path.join(path.sep, 'repo');

    const classification = classifyGitWatchEvents(
      [
        { kind: 'update', path: path.join(gitCommonDir, 'logs', 'HEAD') },
        { kind: 'update', path: path.join(gitCommonDir, 'logs', 'refs', 'heads', 'main') },
      ],
      { gitCommonDir, worktrees: [{ id: 'main', gitDir: gitCommonDir, worktree }] }
    );

    expect(classification.repo).toEqual({
      refs: false,
      remotes: false,
    });
    expect(classification.worktrees.size).toBe(0);
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

  it('ignores common worktrees directory changes for repo facts', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');

    const classification = classifyGitWatchEvents(
      [{ kind: 'create', path: path.join(gitCommonDir, 'worktrees', 'feature', 'gitdir') }],
      { gitCommonDir, worktrees: [] }
    );

    expect(classification.repo).toEqual({
      refs: false,
      remotes: false,
    });
  });

  it('scopes branch and remote ref changes to the worktrees that own or track them', () => {
    const gitCommonDir = path.join(path.sep, 'repo', '.git');
    const worktrees = [
      {
        id: 'main',
        gitDir: gitCommonDir,
        worktree: path.join(path.sep, 'repo'),
        branchRef: 'refs/heads/main',
        upstreamRef: 'refs/remotes/origin/main',
      },
      {
        id: 'feature',
        gitDir: path.join(gitCommonDir, 'worktrees', 'feature'),
        worktree: path.join(path.sep, 'feature'),
        branchRef: 'refs/heads/feature',
        upstreamRef: null,
      },
      {
        id: 'unknown',
        gitDir: path.join(gitCommonDir, 'worktrees', 'unknown'),
        worktree: path.join(path.sep, 'unknown'),
      },
    ];

    const branch = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'refs', 'heads', 'feature') }],
      { gitCommonDir, worktrees }
    );
    expect(branch.worktrees.get('feature')).toEqual({ status: true, head: true });
    expect(branch.worktrees.has('main')).toBe(false);
    expect(branch.worktrees.get('unknown')).toEqual({ status: true, head: true });

    const remote = classifyGitWatchEvents(
      [{ kind: 'update', path: path.join(gitCommonDir, 'refs', 'remotes', 'origin', 'main') }],
      { gitCommonDir, worktrees }
    );
    expect(remote.repo.refs).toBe(true);
    expect(remote.worktrees.get('main')).toEqual({ status: false, head: true });
    expect(remote.worktrees.has('feature')).toBe(false);
    expect(remote.worktrees.get('unknown')).toEqual({ status: false, head: true });
  });
});
