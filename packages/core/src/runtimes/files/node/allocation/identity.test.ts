import type { HostAbsolutePath } from '@primitives/path/api';
import { describe, expect, it } from 'vitest';
import { resolveRootIdentity } from './identity';

describe('resolveRootIdentity', () => {
  it('rejects paths whose style does not belong to the runtime host', async () => {
    const incompatible: HostAbsolutePath =
      process.platform === 'win32'
        ? { root: { kind: 'posix' }, segments: ['workspace'] }
        : { root: { kind: 'drive', driveLetter: 'C' }, segments: ['workspace'] };

    await expect(resolveRootIdentity(incompatible)).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path', message: expect.stringContaining('not valid on this host') },
    });
  });
});
