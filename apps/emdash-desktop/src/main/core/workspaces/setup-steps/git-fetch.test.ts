import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './git-fetch';
import type { StepContext } from './step-context';

const runtime = vi.hoisted(() => ({ runGitJob: vi.fn() }));

vi.mock('@main/core/git/runtime-process/client', async (importOriginal) => ({
  ...(await importOriginal()),
  runGitJob: runtime.runGitJob,
}));

function makeCtx(args: {
  fetch: ReturnType<typeof vi.fn>;
  listWorktrees: ReturnType<typeof vi.fn>;
}) {
  return {
    git: {
      repository: {
        fetch: args.fetch,
        listWorktrees: args.listWorktrees,
      },
    },
    repository: { repository: {} },
  } as unknown as StepContext;
}

const input = {
  remote: 'origin',
  refspec: 'refs/pull/123/head:refs/heads/feature/pr',
  force: true,
} as const;

describe('git-fetch setup step', () => {
  beforeEach(() => {
    runtime.runGitJob.mockImplementation((_definition, handle, jobInput) => handle(jobInput));
  });

  it('treats a checked-out destination branch as already available', async () => {
    const fetch = vi.fn(async () =>
      err({ type: 'git_error' as const, message: 'refusing to fetch into checked out branch' })
    );
    const listWorktrees = vi.fn(async () =>
      ok([
        {
          head: { kind: 'branch' as const, name: 'feature/pr' },
          worktreePath: {} as never,
          isMain: false,
        },
      ])
    );

    await expect(execute(input, makeCtx({ fetch, listWorktrees }))).resolves.toEqual({
      success: true,
      data: {},
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ remote: 'origin', refspec: input.refspec, force: true })
    );
  });

  it('returns the fetch failure when the destination branch is not checked out', async () => {
    const fetch = vi.fn(async () =>
      err({ type: 'git_error' as const, message: 'refusing to fetch into checked out branch' })
    );
    const listWorktrees = vi.fn(async () => ok([]));

    const result = await execute(input, makeCtx({ fetch, listWorktrees }));

    expect(result).toMatchObject({
      success: false,
      error: { type: 'fetch-failed', message: 'refusing to fetch into checked out branch' },
    });
  });

  it('returns the fetch failure when listing worktrees fails', async () => {
    const fetch = vi.fn(async () => err({ type: 'git_error' as const, message: 'fetch failed' }));
    const listWorktrees = vi.fn(async () =>
      err({ type: 'git_error' as const, message: 'not a git repository' })
    );

    const result = await execute(input, makeCtx({ fetch, listWorktrees }));

    expect(result).toMatchObject({
      success: false,
      error: { type: 'fetch-failed', message: 'fetch failed' },
    });
  });
});
