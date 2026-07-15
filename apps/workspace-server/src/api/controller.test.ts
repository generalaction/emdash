import net from 'node:net';
import { PassThrough } from 'node:stream';
import { PROTOCOL_VERSION, workspaceWireContract } from '@emdash/core/workspace-server';
import { ok } from '@emdash/shared';
import { client as createClient, connect, serve, streamTransport } from '@emdash/wire';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAcpRuntimeClient } from '../acp/host';
import { createWorkspaceWireController } from './controller';

describe('createWorkspaceWireController', () => {
  it('forwards ACP procedures to the mounted runtime client', async () => {
    const acp = createFakeAcpClient();
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const controller = createWorkspaceWireController({ acp });
    const disposeServer = serve(streamTransport(clientToServer, serverToClient), controller);
    const transport = streamTransport(serverToClient, clientToServer);
    const wireClient = createClient(workspaceWireContract, connect(transport));

    try {
      const result = await wireClient.acp.startSession({
        input: {
          conversationId: 'conversation-1',
          projectId: 'project-1',
          taskId: 'task-1',
          providerId: 'codex',
          workspaceId: 'workspace-1',
          cwd: '/tmp/project',
          sessionId: null,
          model: null,
        },
      });

      expect(result).toEqual(ok({ sessionId: 'acp-session-1' }));
      expect(acp.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ conversationId: 'conversation-1' }),
        }),
        expect.any(Object)
      );
    } finally {
      disposeServer();
      transport.close?.();
    }
  });

  it('reports ACP procedures as unavailable when no ACP runtime is mounted', async () => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const controller = createWorkspaceWireController();
    const disposeServer = serve(streamTransport(clientToServer, serverToClient), controller);
    const transport = streamTransport(serverToClient, clientToServer);
    const wireClient = createClient(workspaceWireContract, connect(transport));

    try {
      await expect(
        wireClient.acp.startSession({
          input: {
            conversationId: 'conversation-1',
            projectId: 'project-1',
            taskId: 'task-1',
            providerId: 'codex',
            workspaceId: 'workspace-1',
            cwd: '/tmp/project',
            sessionId: null,
            model: null,
          },
        })
      ).rejects.toThrow('ACP runtime is not available.');
    } finally {
      disposeServer();
      transport.close?.();
    }
  });
});

function createFakeAcpClient(): WorkspaceAcpRuntimeClient {
  const acpContract = workspaceWireContract.acp;
  const liveSource = {
    snapshot: async () => ({ version: 0, data: null }),
    attach: async () => () => {},
    asLiveSource: () => null,
  };
  const liveModel = (def: unknown) => ({
    kind: 'liveModelClientHandle' as const,
    def,
    state: () => liveSource,
    mutate: async () => ok(undefined),
  });
  const liveLog = (def: unknown) => ({
    kind: 'liveLogClientHandle' as const,
    def,
    handle: () => liveSource,
  });

  return {
    startSession: vi.fn(async () => ok({ sessionId: 'acp-session-1' })),
    resumeSession: vi.fn(),
    stopSession: vi.fn(),
    sendPrompt: vi.fn(),
    queuePrompt: vi.fn(),
    editQueuedPrompt: vi.fn(),
    deleteQueuedPrompt: vi.fn(),
    changeQueuePromptOrder: vi.fn(),
    cancelTurn: vi.fn(),
    setModelOption: vi.fn(),
    setModeOption: vi.fn(),
    resolvePermission: vi.fn(),
    setPromptDraft: vi.fn(),
    exportACPTranscript: vi.fn(),
    exportRawAcpLog: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    getHistory: vi.fn(),
    sessions: liveModel(acpContract.sessions),
    session: liveModel(acpContract.session),
    terminalOutput: liveLog(acpContract.terminalOutput),
  } as unknown as WorkspaceAcpRuntimeClient;
}

describe('createWorkspaceWireController', () => {
  it('health returns ok status and protocol version', async () => {
    const controller = createWorkspaceWireController({
      appVersion: '1.2.3',
      daemonId: 'daemon-test',
      startedAt: Date.now(),
    });

    const result = await controller.call('health', undefined);

    expect(result).toMatchObject({
      status: 'ok',
      version: '1.2.3',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect((result as { uptimeMs: number }).uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('initializes compatible clients with the negotiated minor version', async () => {
    const controller = createWorkspaceWireController({
      appVersion: '1.2.3',
      daemonId: 'daemon-test',
      startedAt: 100,
    });
    const [major] = PROTOCOL_VERSION.split('.');

    const result = await controller.call('initialize', {
      protocolVersion: `${major}.0.0`,
    });

    expect(result).toEqual({
      success: true,
      data: {
        protocolVersion: PROTOCOL_VERSION,
        agreedVersion: `${major}.0.0`,
        agreedMinor: 0,
        server: {
          appVersion: '1.2.3',
          daemonId: 'daemon-test',
          startedAt: 100,
        },
      },
    });
  });

  it('returns upgrade-client when the client major is too old', async () => {
    const controller = createWorkspaceWireController();

    const result = await controller.call('initialize', {
      protocolVersion: '0.9.0',
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'protocol-incompatible',
        action: 'upgrade-client',
        clientProtocolVersion: '0.9.0',
        serverProtocolVersion: PROTOCOL_VERSION,
      },
    });
  });

  it('returns upgrade-server when the client major is too new', async () => {
    const controller = createWorkspaceWireController();
    const [major] = PROTOCOL_VERSION.split('.');
    const futureVersion = `${Number(major) + 1}.0.0`;

    const result = await controller.call('initialize', {
      protocolVersion: futureVersion,
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'protocol-incompatible',
        action: 'upgrade-server',
        clientProtocolVersion: futureVersion,
        serverProtocolVersion: PROTOCOL_VERSION,
      },
    });
  });

  it('inspects daemon-local preview ports', async () => {
    const server = net.createServer((socket) => socket.end());
    await listen(server, '127.0.0.1', 0);
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('expected TCP listener address');
    }

    const controller = createWorkspaceWireController();

    try {
      const result = await controller.call('portForwards.inspect', { port: address.port });

      expect(result).toEqual({
        success: true,
        data: {
          listening: true,
          families: ['ipv4'],
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('reports closed preview ports as not listening', async () => {
    const server = net.createServer();
    await listen(server, '127.0.0.1', 0);
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('expected TCP listener address');
    }
    await closeServer(server);

    const controller = createWorkspaceWireController();
    const result = await controller.call('portForwards.inspect', { port: address.port });

    expect(result).toEqual({
      success: true,
      data: {
        listening: false,
        families: [],
      },
    });
  });
});

function listen(server: net.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port }, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
