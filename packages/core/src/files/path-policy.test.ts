import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRootPathPolicy } from './path-policy';

describe('createRootPathPolicy', () => {
  it('normalizes a root once and resolves paths inside it', () => {
    const root = path.join('/tmp', 'repo');
    const policy = createRootPathPolicy(path.join(root, '.'));

    expect(policy.success).toBe(true);
    if (!policy.success) return;

    expect(policy.data.rootPath).toBe(root);
    expect(policy.data.resolveInsideRoot(path.join(root, 'src/index.ts'))).toEqual({
      success: true,
      data: path.join(root, 'src/index.ts'),
    });
    expect(policy.data.relativeParts(path.join(root, 'src/index.ts'))).toEqual({
      success: true,
      data: ['src', 'index.ts'],
    });
  });

  it('rejects paths outside the root', () => {
    const policy = createRootPathPolicy('/repo');

    expect(policy.success).toBe(true);
    if (!policy.success) return;

    expect(policy.data.resolveInsideRoot('/other/file.ts')).toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    expect(policy.data.absoluteFromWatchEvent('/other/file.ts')).toBeNull();
  });

  it('rejects null bytes and relative roots', () => {
    expect(createRootPathPolicy('relative-root')).toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    expect(createRootPathPolicy('/repo/\0bad')).toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
  });
});
