import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire/rpc';
import { encodeTopic } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import { mcpContract } from '../api';
import { createMcpWireController } from './wire-controller';

const remoteHost = hostRef('remote', 'ssh-2');

describe('createMcpWireController', () => {
  it('forwards MCP procedures to the selected host', async () => {
    const saveMcpServer = vi.fn(async () => ok(undefined));
    const client = vi.fn(async () => ok({ agentConfig: { saveMcpServer } }));
    const controller = createMcpWireController({ runtimes: { client } as never });
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

    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(saveMcpServer).toHaveBeenCalledWith({ server }, {});
  });

  it('fills in connection details for the managed Emdash entry', async () => {
    const saveMcpServer = vi.fn(async () => ok(undefined));
    const client = vi.fn(async () => ok({ agentConfig: { saveMcpServer } }));
    const controller = createMcpWireController({
      runtimes: { client } as never,
      resolveSelfServer: (providers) =>
        ok({
          name: 'emdash',
          transport: 'http' as const,
          url: 'http://127.0.0.1:8212/mcp',
          headers: { Authorization: 'Bearer secret' },
          providers,
        }),
    });

    await expect(
      controller.call('saveServer', {
        host: LOCAL_HOST_REF,
        server: { name: 'emdash', transport: 'http', url: '', providers: ['claude'] },
      })
    ).resolves.toEqual(ok(undefined));

    expect(saveMcpServer).toHaveBeenCalledWith(
      {
        server: {
          name: 'emdash',
          transport: 'http',
          url: 'http://127.0.0.1:8212/mcp',
          headers: { Authorization: 'Bearer secret' },
          providers: ['claude'],
        },
      },
      {}
    );
  });

  it('fails the managed entry when the local server is not running', async () => {
    const saveMcpServer = vi.fn(async () => ok(undefined));
    const controller = createMcpWireController({
      runtimes: { client: async () => ok({ agentConfig: { saveMcpServer } }) } as never,
      resolveSelfServer: () => err('The Emdash MCP server is not running'),
    });

    await expect(
      controller.call('saveServer', {
        host: LOCAL_HOST_REF,
        server: { name: 'emdash', transport: 'http', url: '', providers: ['claude'] },
      })
    ).resolves.toEqual(
      err({ type: 'invalid-state', message: 'The Emdash MCP server is not running' })
    );
    expect(saveMcpServer).not.toHaveBeenCalled();
  });

  it('leaves a user server named emdash with its own URL alone', async () => {
    const saveMcpServer = vi.fn(async () => ok(undefined));
    const resolveSelfServer = vi.fn();
    const controller = createMcpWireController({
      runtimes: { client: async () => ok({ agentConfig: { saveMcpServer } }) } as never,
      resolveSelfServer: resolveSelfServer as never,
    });
    const server = {
      name: 'emdash',
      transport: 'http' as const,
      url: 'https://mcp.example.com',
      providers: ['claude'],
    };

    await expect(controller.call('saveServer', { host: LOCAL_HOST_REF, server })).resolves.toEqual(
      ok(undefined)
    );

    expect(resolveSelfServer).not.toHaveBeenCalled();
    expect(saveMcpServer).toHaveBeenCalledWith({ server }, {});
  });

  it('does not manage the Emdash entry on a remote host', async () => {
    const saveMcpServer = vi.fn(async () => ok(undefined));
    const resolveSelfServer = vi.fn();
    const controller = createMcpWireController({
      runtimes: { client: async () => ok({ agentConfig: { saveMcpServer } }) } as never,
      resolveSelfServer: resolveSelfServer as never,
    });
    const server = { name: 'emdash', transport: 'http' as const, url: '', providers: ['claude'] };

    await controller.call('saveServer', { host: remoteHost, server });

    expect(resolveSelfServer).not.toHaveBeenCalled();
    expect(saveMcpServer).toHaveBeenCalledWith({ server }, {});
  });

  it('resolves the host for the MCP live model', async () => {
    const source = liveSource([]);
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const controller = createMcpWireController({
      runtimes: {
        client: async () => ok({ agentConfig: { mcpServers: { state } } }),
      } as never,
    });
    const topic = encodeTopic(mcpContract.servers.states.list.id, { host: remoteHost });

    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);
    expect(state).toHaveBeenCalledWith(undefined, 'list');

    await lease?.release();
  });
});

function liveSource(data: unknown): LiveSource {
  return {
    snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data }),
    subscribe: () => () => {},
  };
}
