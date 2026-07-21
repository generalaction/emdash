import { describe, expect, it } from 'vitest';
import { provisionBYOITask } from './provision-byoi-task';

describe('provisionBYOITask', () => {
  it('returns a typed not-configured error before a remote host exists', async () => {
    await expect(
      provisionBYOITask({
        host: { type: 'remote', id: 'connection-1' },
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'not-configured',
        host: { type: 'remote', id: 'connection-1' },
        message:
          'Remote workspaces require the workspace server and are not supported by this build',
      },
    });
  });
});
