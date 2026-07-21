import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManualClock, deferred } from '@emdash/shared/testing';
import type { WireTransport } from '@emdash/wire';
import { describe, expect, it, vi } from 'vitest';
import { createTestWorkspaceWireController } from '../../../../../../../workspace-server/src/testing/controller';
import { serveSocket } from '../../../../../../../workspace-server/src/wire/serve-socket';
import { dialWorkspaceServerOnce } from './dial-once';
import { openLocalWorkspaceServerTransport } from './local-socket-transport';

describe('dialWorkspaceServerOnce', () => {
  it('handshakes and always closes the probe transport', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-workspace-dial-'));
    const target = { kind: 'local-socket' as const, socketPath: join(directory, 'workspace.sock') };
    const server = await serveSocket(
      createTestWorkspaceWireController({}, { daemonId: 'dial-daemon' }),
      { socketPath: target.socketPath }
    );
    let closeCount = 0;

    try {
      const handshake = await dialWorkspaceServerOnce(target, {
        openTransport: async (next) => {
          if (next.kind !== 'local-socket') throw new Error('Expected local target');
          const inner = await openLocalWorkspaceServerTransport(next);
          return {
            ...inner,
            close() {
              closeCount += 1;
              inner.close?.();
            },
          };
        },
      });

      expect(handshake.server.daemonId).toBe('dial-daemon');
      expect(closeCount).toBe(1);
    } finally {
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('closes a transport that opens after the dial timeout', async () => {
    const clock = createManualClock();
    const opened = deferred<WireTransport>();
    const close = vi.fn();
    const pending = dialWorkspaceServerOnce(
      { kind: 'local-socket', socketPath: '/tmp/late-workspace.sock' },
      {
        clock,
        timeoutMs: 1,
        openTransport: () => opened.promise,
      }
    );

    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await clock.advanceBy(1);
    await rejected;
    opened.resolve({
      post: vi.fn(),
      onMessage: () => () => {},
      onDisconnect: () => () => {},
      close,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledOnce();
  });
});
