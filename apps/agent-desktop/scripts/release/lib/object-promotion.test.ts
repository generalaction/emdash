import { describe, expect, it, vi } from 'vitest';
import {
  PromotionCommitUncertainError,
  promoteObjectsWithRollback,
  snapshotPromotionObjects,
} from './object-promotion.ts';

function memoryStore(initial: Readonly<Record<string, string>> = {}) {
  const objects = new Map(Object.entries(initial));
  return {
    objects,
    store: {
      read: vi.fn(async (key: string) => objects.get(key) ?? null),
      write: vi.fn(async (key: string, value: string) => {
        objects.set(key, value);
      }),
      remove: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    },
  };
}

const desired = [
  { key: 'v1-stable.yml', value: 'new-win' },
  { key: 'v1-stable-mac.yml', value: 'new-mac' },
  { key: 'v1-stable-linux.yml', value: 'new-linux' },
];

describe('promoteObjectsWithRollback', () => {
  it('writes every desired object before committing', async () => {
    const { objects, store } = memoryStore();
    const commit = vi.fn(async () => {
      expect(Object.fromEntries(objects)).toEqual({
        'v1-stable.yml': 'new-win',
        'v1-stable-mac.yml': 'new-mac',
        'v1-stable-linux.yml': 'new-linux',
      });
    });

    await promoteObjectsWithRollback(desired, store, commit);

    expect(commit).toHaveBeenCalledOnce();
  });

  it('restores the complete previous set when promotion fails partway through', async () => {
    const previous = {
      'v1-stable.yml': 'old-win',
      'v1-stable-mac.yml': 'old-mac',
    };
    const { objects, store } = memoryStore(previous);
    store.write.mockImplementationOnce(async (key, value) => {
      objects.set(key, value);
    });
    store.write.mockRejectedValueOnce(new Error('R2 unavailable'));

    await expect(promoteObjectsWithRollback(desired, store, vi.fn())).rejects.toThrow(
      'R2 unavailable'
    );
    expect(Object.fromEntries(objects)).toEqual(previous);
    expect(store.remove).toHaveBeenCalledWith('v1-stable-linux.yml');
  });

  it('restores prior objects when the external commit is known to have failed', async () => {
    const previous = { 'v1-stable.yml': 'old-win' };
    const { objects, store } = memoryStore(previous);

    await expect(
      promoteObjectsWithRollback(desired, store, async () => {
        throw new Error('GitHub rejected publication');
      })
    ).rejects.toThrow('GitHub rejected publication');
    expect(Object.fromEntries(objects)).toEqual(previous);
  });

  it('keeps the complete promoted set when external commit status is uncertain', async () => {
    const { objects, store } = memoryStore({ 'v1-stable.yml': 'old-win' });

    await expect(
      promoteObjectsWithRollback(desired, store, async () => {
        throw new PromotionCommitUncertainError('Cannot confirm GitHub state');
      })
    ).rejects.toThrow(PromotionCommitUncertainError);
    expect(Object.fromEntries(objects)).toEqual({
      'v1-stable.yml': 'new-win',
      'v1-stable-mac.yml': 'new-mac',
      'v1-stable-linux.yml': 'new-linux',
    });
  });

  it('reuses the original snapshot across attempts after an uncertain commit', async () => {
    const previous = {
      'v1-stable.yml': 'old-win',
      'v1-stable-mac.yml': 'old-mac',
      'v1-stable-linux.yml': 'old-linux',
    };
    const { objects, store } = memoryStore(previous);
    const originalSnapshot = await snapshotPromotionObjects(desired, store);

    await expect(
      promoteObjectsWithRollback(
        desired,
        store,
        async () => {
          throw new PromotionCommitUncertainError('First commit status is unknown');
        },
        { rollbackSnapshot: originalSnapshot }
      )
    ).rejects.toThrow(PromotionCommitUncertainError);
    expect(Object.fromEntries(objects)).toEqual({
      'v1-stable.yml': 'new-win',
      'v1-stable-mac.yml': 'new-mac',
      'v1-stable-linux.yml': 'new-linux',
    });

    await expect(
      promoteObjectsWithRollback(
        desired,
        store,
        async () => {
          throw new Error('Second commit definitively failed');
        },
        { rollbackSnapshot: originalSnapshot }
      )
    ).rejects.toThrow('Second commit definitively failed');
    expect(Object.fromEntries(objects)).toEqual(previous);
  });
});
