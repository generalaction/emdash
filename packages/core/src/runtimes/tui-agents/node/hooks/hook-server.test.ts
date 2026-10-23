import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it } from 'vitest';
import { TuiHookServer } from './hook-server';

describe('TuiHookServer', () => {
  it('settles a pending start when stopped before listening', async () => {
    const server = new TuiHookServer(async () => {}, noopLogger);
    try {
      const starting = server.ensureStarted();

      server.stop();
      const restarted = server.ensureStarted();

      await expect(starting).rejects.toThrow('Hook server stopped');
      await expect(restarted).resolves.toMatchObject({ port: expect.any(Number) });
    } finally {
      server.stop();
    }
  });
});
