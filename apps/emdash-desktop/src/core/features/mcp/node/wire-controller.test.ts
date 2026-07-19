import { hostRef } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { encodeTopic } from '@emdash/wire/api';
import { describe, expect, it, vi } from 'vitest';
import { mcpContract } from '../api';
import { createMcpWireController } from './wire-controller';

const remoteHost = hostRef('remote', 'ssh-2');

describe('createMcpWireController', () => {
  it('forwards MCP procedures to the selected host and releases the lease', async () => {
    const saveMcpServer = vi.fn(async () => ok(undefined));
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ agentConfig: { saveMcpServer } }),
      release,
    }));
    const controller = createMcpWireController({ runtimes: { session } as never });
    const server = {
      name: 'context7',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: {},
      providers: [],
    };

    await expect(controller.call('saveServer', { host: remoteHost, server })).resolves.toEqual(
      ok(undefined)
    );

    expect(session).toHaveBeenCalledWith(remoteHost);
    expect(saveMcpServer).toHaveBeenCalledWith({ server }, {});
    expect(release).toHaveBeenCalledOnce();
  });

  it('holds the host lease while the MCP live model is attached', async () => {
    const source = liveSource([]);
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const release = vi.fn(async () => {});
    const controller = createMcpWireController({
      runtimes: {
        session: () => ({
          ready: async () => ok({ agentConfig: { mcpServers: { state } } }),
          release,
        }),
      } as never,
    });
    const topic = encodeTopic(mcpContract.servers.states.list.id, { host: remoteHost });

    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);
    expect(state).toHaveBeenCalledWith(undefined, 'list');
    expect(release).not.toHaveBeenCalled();

    await lease?.release();
    expect(release).toHaveBeenCalledOnce();
  });
});

function liveSource(data: unknown): LiveSource {
  return {
    snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data }),
    subscribe: () => () => {},
  };
}
