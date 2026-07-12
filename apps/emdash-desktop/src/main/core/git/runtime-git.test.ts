import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeGitCheckout } from './runtime-git';

vi.mock('./runtime-process/host', () => ({
  getGitRuntimeClient: vi.fn(),
}));

describe('RuntimeGitCheckout paths', () => {
  it('maps native absolute and separator-delimited paths to checkout-relative paths', async () => {
    const isFileTracked = vi.fn().mockResolvedValue(ok(true));
    const getFileAtIndex = vi.fn().mockResolvedValue(ok('content'));
    const client = {
      checkout: {
        isFileTracked,
        getFileAtIndex,
        model: {
          state: vi.fn(() => ({
            snapshot: async () => ({
              data: {
                kind: 'ok',
                entries: {},
                summary: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
              },
            }),
          })),
        },
      },
    };
    const checkout = new RuntimeGitCheckout('/repo', async () => client as never);

    await expect(checkout.isFileTracked('/repo/src/file.ts')).resolves.toEqual(ok(true));
    await expect(checkout.getFileAtIndex('src\\other.ts')).resolves.toEqual(ok('content'));
    await expect(checkout.isFileCleanlyTracked('/repo/.emdash.json')).resolves.toBe(true);

    expect(isFileTracked).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/file.ts' }));
    expect(getFileAtIndex).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'src/other.ts' })
    );
    expect(getFileAtIndex).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '.emdash.json' })
    );
  });
});
