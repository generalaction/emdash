import { Readable, Writable } from 'node:stream';
import type { AnyRequest, AnyResponse, Client } from '@agentclientprotocol/sdk';
import type { AcpClientFactory } from '@emdash/core/agents/plugins';
import { describe, expect, it, vi } from 'vitest';
import { pluginRegistry } from '../../registry';

describe('grok acp behavior', () => {
  it('normalizes model state and maps model changes to session/set_model', async () => {
    const stdout = new Readable({ read: () => {} });
    const requests: AnyRequest[] = [];
    const sessionUpdate = vi.fn();
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
        } else if (request.method === 'session/prompt') {
          respond(stdout, request.id, { stopReason: 'end_turn' });
        }

        callback();
      },
    });
    const toClient: AcpClientFactory = () =>
      ({ requestPermission: vi.fn(), sessionUpdate }) as Client;
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

    await agent.prompt({
      sessionId: 'grok-session-1',
      prompt: [{ type: 'text', text: 'Lock this session to the selected agent family' }],
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      sessionId: 'grok-session-1',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: [
          expect.objectContaining({
            id: 'model',
            currentValue: 'grok-composer-2.5-fast',
            options: [expect.objectContaining({ value: 'grok-composer-2.5-fast' })],
          }),
        ],
      },
    });

    stdout.push(null);
  });

  it('normalizes versioned model IDs and locks loaded sessions to their agent family', async () => {
    const stdout = new Readable({ read: () => {} });
    const stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(chunk.toString()) as AnyRequest;
        if (request.method === 'session/load') {
          respond(stdout, request.id, {
            models: {
              currentModelId: 'grok-build-0.1',
              availableModels: [
                { modelId: 'grok-build', name: 'Grok Build' },
                { modelId: 'grok-composer-2.5-fast', name: 'Composer 2.5' },
              ],
            },
          });
        }
        callback();
      },
    });
    const toClient: AcpClientFactory = () =>
      ({ requestPermission: vi.fn(), sessionUpdate: vi.fn() }) as Client;
    const agent = pluginRegistry.get('grok')!.behavior.acp!.connect({ stdin, stdout }, toClient);

    const session = await agent.loadSession?.({
      sessionId: 'grok-session-loaded',
      cwd: '/worktree',
      mcpServers: [],
    });

    expect(session?.configOptions).toEqual([
      expect.objectContaining({
        id: 'model',
        currentValue: 'grok-build',
        options: [expect.objectContaining({ value: 'grok-build' })],
      }),
    ]);

    stdout.push(null);
  });
});

function respond(stdout: Readable, id: AnyResponse['id'], result: unknown): void {
  stdout.push(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
