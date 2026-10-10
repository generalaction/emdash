import type { McpServer } from '@emdash/core/primitives/mcp/api';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { refreshSelfServerRegistration, resolveSelfServer } from './self-registration';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
const connection = { url: 'http://127.0.0.1:8212/mcp', token: 'abc123' };

function dependencies(options: {
  installed: McpServer[];
  saveMcpServer?: ReturnType<typeof vi.fn>;
  getConnectionInfo?: () => typeof connection | null;
}) {
  const saveMcpServer = options.saveMcpServer ?? vi.fn(async () => ok(undefined));
  const client = vi.fn(async () =>
    ok({
      agentConfig: {
        mcpServers: {
          state: () => ({ snapshot: async () => ({ data: options.installed }) }),
        },
        saveMcpServer,
      },
    })
  );
  return {
    saveMcpServer,
    client,
    dependencies: {
      runtimes: { client } as never,
      logger,
      getConnectionInfo: options.getConnectionInfo ?? (() => connection),
    },
  };
}

describe('resolveSelfServer', () => {
  it('builds the entry from the running server for the given agents', () => {
    const { dependencies: deps } = dependencies({ installed: [] });

    expect(resolveSelfServer(deps, ['claude', 'codex'])).toEqual(
      ok({
        name: 'emdash',
        transport: 'http',
        url: connection.url,
        headers: { Authorization: `Bearer ${connection.token}` },
        providers: ['claude', 'codex'],
      })
    );
  });

  it('fails when the server is not running', () => {
    const { dependencies: deps } = dependencies({ installed: [], getConnectionInfo: () => null });

    expect(resolveSelfServer(deps, ['claude'])).toEqual(
      err('The Emdash MCP server is not running')
    );
  });
});

describe('refreshSelfServerRegistration', () => {
  it('rewrites an existing registration with the current connection details', async () => {
    const { dependencies: deps, saveMcpServer } = dependencies({
      installed: [
        {
          name: 'emdash',
          transport: 'http',
          url: 'http://127.0.0.1:9999/mcp',
          headers: { Authorization: 'Bearer stale' },
          enabled: true,
          providers: ['claude'],
        },
      ],
    });

    await refreshSelfServerRegistration(deps);

    expect(saveMcpServer).toHaveBeenCalledWith({
      server: {
        name: 'emdash',
        transport: 'http',
        url: connection.url,
        headers: { Authorization: `Bearer ${connection.token}` },
        // User-set fields survive the heal.
        enabled: true,
        providers: ['claude'],
      },
    });
  });

  it('does not create a registration the user never made', async () => {
    const { dependencies: deps, saveMcpServer } = dependencies({ installed: [] });

    await refreshSelfServerRegistration(deps);

    expect(saveMcpServer).not.toHaveBeenCalled();
  });

  it('leaves an unrelated server named emdash untouched', async () => {
    const { dependencies: deps, saveMcpServer } = dependencies({
      installed: [
        {
          name: 'emdash',
          transport: 'http',
          url: 'https://mcp.example.com',
          providers: ['claude'],
        },
      ],
    });

    await refreshSelfServerRegistration(deps);

    expect(saveMcpServer).not.toHaveBeenCalled();
  });

  it('does nothing while the server is not running', async () => {
    const { dependencies: deps, client } = dependencies({
      installed: [
        { name: 'emdash', transport: 'http', url: connection.url, providers: ['claude'] },
      ],
      getConnectionInfo: () => null,
    });

    await refreshSelfServerRegistration(deps);

    expect(client).not.toHaveBeenCalled();
  });
});
