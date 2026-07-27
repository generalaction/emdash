import type * as Wire from '@emdash/wire';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitRepositoryService } from './service';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  onChange: vi.fn(),
  ready: Promise.resolve(),
  warn: vi.fn(),
}));

vi.mock('@emdash/wire', async (importOriginal) => ({
  ...(await importOriginal<typeof Wire>()),
  ReplicaState: vi.fn(function ReplicaState() {
    return {
    dispose: mocks.dispose,
    onChange: mocks.onChange,
    ready: mocks.ready,
    };
  }),
}));

vi.mock('@emdash/shared/logger', () => ({
  log: { warn: mocks.warn },
}));

describe('GitRepositoryService', () => {
  beforeEach(() => {
    mocks.dispose.mockReset();
    mocks.onChange.mockReset();
    mocks.warn.mockReset();
    mocks.ready = Promise.resolve();
  });

  it('treats a remotes seed failure as a safe no-op subscription', async () => {
    mocks.ready = Promise.reject(new Error('not a git repository'));
    const service = new GitRepositoryService(
      { repository: { model: { state: vi.fn() } } } as never,
      { repository: { root: { kind: 'posix' }, segments: ['plain-folder'] } } as never,
      { get: vi.fn() }
    );

    const unsubscribe = service.subscribeRemotes(vi.fn());

    await vi.waitFor(() =>
      expect(mocks.warn).toHaveBeenCalledWith(
        'GitRepositoryService: failed to subscribe to remotes',
        expect.objectContaining({ error: 'not a git repository' })
      )
    );
    expect(mocks.onChange).not.toHaveBeenCalled();

    unsubscribe();

    await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalled());
  });
});
