import type { GitChange, GitStatusData, GitStatusModel } from '@emdash/core/git';
import { describe, expect, it } from 'vitest';
import { ModelMirror, OptimisticModel } from '@renderer/lib/stores/live';
import { ok, type Result } from '@shared/lib/result';
import {
  commitOptimistically,
  discardAllOptimistically,
  discardFilesOptimistically,
  stageAllOptimistically,
  stageFilesOptimistically,
  unstageAllOptimistically,
  unstageFilesOptimistically,
} from './git-status-optimistic-updates';

function change(path: string, additions = 1, deletions = 0): GitChange {
  return {
    path,
    status: 'modified',
    additions,
    deletions,
  };
}

function status({
  staged = [],
  unstaged = [],
}: {
  staged?: GitChange[];
  unstaged?: GitChange[];
} = {}): GitStatusData {
  return {
    kind: 'ok',
    staged,
    unstaged,
    stagedAdded: staged.reduce((sum, change) => sum + change.additions, 0),
    stagedDeleted: staged.reduce((sum, change) => sum + change.deletions, 0),
  };
}

function liveStatus(model: GitStatusModel, sequence: number, generation = 1) {
  return { value: model, sequence, generation };
}

describe('git status optimistic updates', () => {
  it('stages selected unstaged files and recounts staged totals', () => {
    const model = status({
      staged: [change('src/a.ts', 1, 1)],
      unstaged: [change('src/b.ts', 2, 0), change('src/c.ts', 0, 3)],
    });

    const next = stageFilesOptimistically(model, ['src/b.ts']);

    expect(next).toEqual(
      status({
        staged: [change('src/a.ts', 1, 1), change('src/b.ts', 2, 0)],
        unstaged: [change('src/c.ts', 0, 3)],
      })
    );
  });

  it('stages all unstaged files and keeps one entry per path', () => {
    const model = status({
      staged: [change('src/a.ts', 1, 0)],
      unstaged: [change('src/a.ts', 2, 0), change('src/b.ts', 0, 1)],
    });

    const next = stageAllOptimistically(model);

    expect(next).toEqual(
      status({
        staged: [change('src/a.ts', 2, 0), change('src/b.ts', 0, 1)],
      })
    );
  });

  it('unstages selected staged files and clears their staged totals', () => {
    const model = status({
      staged: [change('src/a.ts', 1, 1), change('src/b.ts', 2, 0)],
      unstaged: [change('src/c.ts', 0, 3)],
    });

    const next = unstageFilesOptimistically(model, ['src/a.ts']);

    expect(next).toEqual(
      status({
        staged: [change('src/b.ts', 2, 0)],
        unstaged: [change('src/c.ts', 0, 3), change('src/a.ts', 1, 1)],
      })
    );
  });

  it('unstages all staged files and resets staged totals', () => {
    const model = status({
      staged: [change('src/a.ts', 1, 1), change('src/b.ts', 2, 0)],
      unstaged: [change('src/a.ts', 4, 0)],
    });

    const next = unstageAllOptimistically(model);

    expect(next).toEqual(
      status({
        unstaged: [change('src/a.ts', 1, 1), change('src/b.ts', 2, 0)],
      })
    );
  });

  it('discards selected unstaged files', () => {
    const model = status({
      staged: [change('src/a.ts', 1, 0)],
      unstaged: [change('src/b.ts', 2, 0), change('src/c.ts', 0, 3)],
    });

    const next = discardFilesOptimistically(model, ['src/b.ts']);

    expect(next).toEqual(
      status({
        staged: [change('src/a.ts', 1, 0)],
        unstaged: [change('src/c.ts', 0, 3)],
      })
    );
  });

  it('discards all unstaged files', () => {
    const model = status({
      staged: [change('src/a.ts', 1, 0)],
      unstaged: [change('src/b.ts', 2, 0), change('src/c.ts', 0, 3)],
    });

    const next = discardAllOptimistically(model);

    expect(next).toEqual(status({ staged: [change('src/a.ts', 1, 0)] }));
  });

  it('clears staged files after an optimistic commit', () => {
    const model = status({
      staged: [change('src/a.ts', 1, 0)],
      unstaged: [change('src/b.ts', 2, 0)],
    });

    const next = commitOptimistically(model);

    expect(next).toEqual(status({ unstaged: [change('src/b.ts', 2, 0)] }));
  });

  it('leaves non-ok models unchanged', () => {
    const model: GitStatusModel = { kind: 'too-many-files' };

    expect(stageFilesOptimistically(model, ['src/a.ts'])).toBe(model);
    expect(stageAllOptimistically(model)).toBe(model);
    expect(unstageFilesOptimistically(model, ['src/a.ts'])).toBe(model);
    expect(unstageAllOptimistically(model)).toBe(model);
    expect(discardFilesOptimistically(model, ['src/a.ts'])).toBe(model);
    expect(discardAllOptimistically(model)).toBe(model);
    expect(commitOptimistically(model)).toBe(model);
  });

  it('keeps staged paths visible when live status catches up before the mutation result', async () => {
    const mirror = new ModelMirror<GitStatusModel>();
    mirror.setSnapshot(
      liveStatus(status({ unstaged: [change('src/a.ts'), change('src/b.ts')] }), 1)
    );
    const optimistic = new OptimisticModel<GitStatusModel>(mirror);

    let resolveMutation!: (result: Result<{ sequence: number }, never>) => void;
    const run = optimistic.run(
      (model) => stageFilesOptimistically(model, ['src/a.ts']),
      () =>
        new Promise<Result<{ sequence: number }, never>>((resolve) => {
          resolveMutation = resolve;
        }),
      (data) => data.sequence
    );

    expect(optimistic.value).toEqual(
      status({
        staged: [change('src/a.ts')],
        unstaged: [change('src/b.ts')],
      })
    );

    mirror.applyUpdate(
      liveStatus(status({ staged: [change('src/a.ts')], unstaged: [change('src/b.ts')] }), 2)
    );

    expect(optimistic.value).toEqual(
      status({
        staged: [change('src/a.ts')],
        unstaged: [change('src/b.ts')],
      })
    );

    resolveMutation(ok({ sequence: 2 }));
    await run;

    expect(optimistic.value).toEqual(
      status({
        staged: [change('src/a.ts')],
        unstaged: [change('src/b.ts')],
      })
    );
  });
});
