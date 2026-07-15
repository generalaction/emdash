import { Readable, Writable } from 'node:stream';
import type { AnyRequest, AnyResponse, Client } from '@agentclientprotocol/sdk';
import type { AcpClientFactory } from '@emdash/core/agents/plugins';
import { describe, expect, it, vi } from 'vitest';
import { pluginRegistry } from '../../registry';

describe('grok acp behavior', () => {
  it('normalizes model state and maps model changes to session/set_model', async () => {
    const stdout = new Readable({ read: () => {} });
    const requests: AnyRequest[] = [];
    const stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(chunk.toString()) as AnyRequest;
        requests.push(request);

        if (request.method === 'session/new') {
          respond(stdout, request.id, {
            sessionId: 'grok-session-1',
            models: {
              currentModelId: 'grok-4.5',
              availableModels: [
                {
                  modelId: 'grok-4.5',
                  name: 'Grok 4.5',
                  description: "SpaceXAI's new frontier model",
                },
                {
                  modelId: 'grok-composer-2.5-fast',
                  name: 'Composer 2.5',
                  description: "Cursor's latest coding model",
                },
              ],
            },
          });
        } else if (request.method === 'session/set_model') {
          respond(stdout, request.id, { _meta: { model: { Ok: 'grok-composer-2.5-fast' } } });
        }

        callback();
      },
    });
    const toClient: AcpClientFactory = () =>
      ({ requestPermission: vi.fn(), sessionUpdate: vi.fn() }) as Client;
    const agent = pluginRegistry.get('grok')!.behavior.acp!.connect({ stdin, stdout }, toClient);

    const session = await agent.newSession({ cwd: '/worktree', mcpServers: [] });
    expect(session.configOptions).toEqual([
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'grok-4.5',
        options: [
          {
            value: 'grok-4.5',
            name: 'Grok 4.5',
            description: "SpaceXAI's new frontier model",
          },
          {
            value: 'grok-composer-2.5-fast',
            name: 'Composer 2.5',
            description: "Cursor's latest coding model",
          },
        ],
      },
    ]);

    const changed = await agent.setSessionConfigOption?.({
      sessionId: 'grok-session-1',
      configId: 'model',
      value: 'grok-composer-2.5-fast',
    });
    expect(requests.at(-1)).toMatchObject({
      method: 'session/set_model',
      params: {
        sessionId: 'grok-session-1',
        modelId: 'grok-composer-2.5-fast',
      },
    });
    expect(changed?.configOptions[0]).toMatchObject({
      id: 'model',
      currentValue: 'grok-composer-2.5-fast',
    });

    stdout.push(null);
  });
});

function respond(stdout: Readable, id: AnyResponse['id'], result: unknown): void {
  stdout.push(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
