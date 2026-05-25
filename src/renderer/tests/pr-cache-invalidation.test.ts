import { describe, expect, it } from 'vitest';
import { shouldInvalidatePrListQuery } from '@renderer/lib/should-invalidate-pr-list-query';
import type { PrSyncProgress } from '@shared/pull-requests';

function progress(overrides: Partial<PrSyncProgress> = {}): PrSyncProgress {
  return {
    remoteUrl: 'https://github.com/acme/repo',
    kind: 'full',
    status: 'done',
    ...overrides,
  };
}

describe('shouldInvalidatePrListQuery', () => {
  it('invalidates the project PR view when the synced remote matches', () => {
    const key = ['pull-requests', 'project-1', 'https://github.com/acme/repo'] as const;
    expect(shouldInvalidatePrListQuery(key, progress())).toBe(true);
  });

  it('does not invalidate the project PR view for unrelated remotes', () => {
    const key = ['pull-requests', 'project-1', 'https://github.com/other/repo'] as const;
    expect(shouldInvalidatePrListQuery(key, progress())).toBe(false);
  });

  it('invalidates inline PR picker queries after sync completes', () => {
    const key = [
      'pull-requests-inline',
      'project-1',
      'https://github.com/user/fork',
      'open',
    ] as const;
    expect(shouldInvalidatePrListQuery(key, progress())).toBe(true);
  });

  it('does not invalidate inline PR picker queries while sync is still running', () => {
    const key = [
      'pull-requests-inline',
      'project-1',
      'https://github.com/user/fork',
      'open',
    ] as const;
    expect(shouldInvalidatePrListQuery(key, progress({ status: 'running' }))).toBe(false);
  });

  it('ignores unrelated query keys', () => {
    expect(shouldInvalidatePrListQuery(['issues'], progress())).toBe(false);
  });
});
