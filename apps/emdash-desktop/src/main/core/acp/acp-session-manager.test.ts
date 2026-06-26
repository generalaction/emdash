import type { AcpRuntimeListener } from '@emdash/core/acp';
import { noopLogger } from '@emdash/shared/logger';
/**
 * Tests for the thin @main AcpSessionManager router.
 *
 * Covers machine-routing, per-machine runtime creation, conversation→machine
 * mapping, and delegation (stop, isRunning, getChatHistory, getSessionState).
 *
 * Engine behaviour (pooling, turns, permissions, replay) is tested in
 * packages/core/src/acp/acp-session-runtime.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@main/core/runtime/types';
import { AcpSessionManager } from './acp-session-manager';
import type { AcpSessionManagerDeps } from './acp-session-manager';
import { FakeAcpProcessHost, makeConversation } from './acp-test-support';

// ---------------------------------------------------------------------------
// Helper: build manager deps
// ---------------------------------------------------------------------------

function makeManagerDeps(overrides: Partial<AcpSessionManagerDeps> = {}): AcpSessionManagerDeps {
  const fakeHost = new FakeAcpProcessHost();

  const listener: AcpRuntimeListener = {
    onSnapshot: vi.fn(),
    onSessionUpdate: vi.fn(),
    onTurnCommitted: vi.fn(),
    onClosed: vi.fn(),
    onAgentEvent: vi.fn(),
    onTerminalCreated: vi.fn(),
    onTerminalOutput: vi.fn(),
    onTerminalExit: vi.fn(),
    onTerminalReleased: vi.fn(),
  };

  return {
    getPlugin: (() => ({
      capabilities: {
        acp: { kind: 'supported' },
        hostDependency: { binaryNames: ['claude'] },
      },
      behavior: {
        acp: {
          buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
          connect: (_io: unknown, toClient: (agent: unknown) => unknown) => {
            const agent = {
              initialize: vi.fn().mockResolvedValue({ protocolVersion: 1 }),
              newSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
              cancel: vi.fn().mockResolvedValue({}),
              prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
            };
            toClient(agent);
            return agent;
          },
        },
      },
    })) as unknown as AcpSessionManagerDeps['getPlugin'],
    acquireProcessHost: vi.fn().mockResolvedValue(fakeHost),
    listener,
    setSessionId: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    log: noopLogger,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Machine routing
// ---------------------------------------------------------------------------

describe('AcpSessionManager – machine routing', () => {
  it('calls acquireProcessHost with the local MachineRef', async () => {
    const deps = makeManagerDeps();
    const mgr = new AcpSessionManager(deps);

    const localMachine: MachineRef = { kind: 'local' };
    await mgr.start(
      makeConversation({ conversationId: 'conv-local' }),
      'ws-1',
      '/tmp',
      localMachine
    );

    expect(deps.acquireProcessHost).toHaveBeenCalledWith(localMachine);
    expect(mgr.isRunning('conv-local')).toBe(true);
  });

  it('calls acquireProcessHost with the SSH MachineRef', async () => {
    const deps = makeManagerDeps();
    const mgr = new AcpSessionManager(deps);

    const sshMachine: MachineRef = { kind: 'ssh', connectionId: 'conn-42' };
    await mgr.start(
      makeConversation({ conversationId: 'conv-ssh' }),
      'ws-1',
      '/remote',
      sshMachine
    );

    expect(deps.acquireProcessHost).toHaveBeenCalledWith(sshMachine);
    expect(mgr.isRunning('conv-ssh')).toBe(true);
  });

  it('two conversations on the same machine reuse the same runtime (acquireProcessHost called once)', async () => {
    const deps = makeManagerDeps();
    const mgr = new AcpSessionManager(deps);

    const machine: MachineRef = { kind: 'local' };
    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp', machine);
    await mgr.start(makeConversation({ conversationId: 'conv-b' }), 'ws-2', '/tmp2', machine);

    expect(deps.acquireProcessHost).toHaveBeenCalledTimes(1);
    expect(mgr.isRunning('conv-a')).toBe(true);
    expect(mgr.isRunning('conv-b')).toBe(true);
  });

  it('two conversations on different machines get separate runtimes (acquireProcessHost called twice)', async () => {
    const fakeHost1 = new FakeAcpProcessHost();
    const fakeHost2 = new FakeAcpProcessHost();
    const acquireProcessHost = vi
      .fn()
      .mockResolvedValueOnce(fakeHost1)
      .mockResolvedValueOnce(fakeHost2);

    const deps = makeManagerDeps({ acquireProcessHost });
    const mgr = new AcpSessionManager(deps);

    const localMachine: MachineRef = { kind: 'local' };
    const sshMachine: MachineRef = { kind: 'ssh', connectionId: 'conn-1' };

    await mgr.start(
      makeConversation({ conversationId: 'conv-local' }),
      'ws-1',
      '/tmp',
      localMachine
    );
    await mgr.start(
      makeConversation({ conversationId: 'conv-ssh' }),
      'ws-1',
      '/remote',
      sshMachine
    );

    expect(acquireProcessHost).toHaveBeenCalledTimes(2);
    expect(acquireProcessHost).toHaveBeenNthCalledWith(1, localMachine);
    expect(acquireProcessHost).toHaveBeenNthCalledWith(2, sshMachine);
    expect(mgr.isRunning('conv-local')).toBe(true);
    expect(mgr.isRunning('conv-ssh')).toBe(true);
  });

  it('two SSH conversations with different connection IDs get separate runtimes', async () => {
    const acquireProcessHost = vi
      .fn()
      .mockResolvedValueOnce(new FakeAcpProcessHost())
      .mockResolvedValueOnce(new FakeAcpProcessHost());

    const deps = makeManagerDeps({ acquireProcessHost });
    const mgr = new AcpSessionManager(deps);

    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/r1', {
      kind: 'ssh',
      connectionId: 'conn-1',
    });
    await mgr.start(makeConversation({ conversationId: 'conv-b' }), 'ws-2', '/r2', {
      kind: 'ssh',
      connectionId: 'conn-2',
    });

    expect(acquireProcessHost).toHaveBeenCalledTimes(2);
    expect(acquireProcessHost).toHaveBeenNthCalledWith(1, {
      kind: 'ssh',
      connectionId: 'conn-1',
    });
    expect(acquireProcessHost).toHaveBeenNthCalledWith(2, {
      kind: 'ssh',
      connectionId: 'conn-2',
    });
  });
});

// ---------------------------------------------------------------------------
// Delegation and cleanup
// ---------------------------------------------------------------------------

describe('AcpSessionManager – delegation and cleanup', () => {
  it('stop removes the conversation from isRunning', async () => {
    const deps = makeManagerDeps();
    const mgr = new AcpSessionManager(deps);

    await mgr.start(makeConversation({ conversationId: 'conv-x' }), 'ws-1', '/tmp', {
      kind: 'local',
    });
    expect(mgr.isRunning('conv-x')).toBe(true);

    mgr.stop('conv-x');
    expect(mgr.isRunning('conv-x')).toBe(false);
  });

  it('stop on unknown conversation is a no-op', () => {
    const deps = makeManagerDeps();
    const mgr = new AcpSessionManager(deps);
    expect(() => mgr.stop('no-such-conv')).not.toThrow();
  });

  it('getChatHistory returns empty result when no runtime exists for conversation', () => {
    const deps = makeManagerDeps();
    const mgr = new AcpSessionManager(deps);
    expect(mgr.getChatHistory('no-such-conv')).toEqual({ turns: [], complete: true });
  });

  it('getSessionState returns closed state when no runtime exists for conversation', () => {
    const deps = makeManagerDeps();
    const mgr = new AcpSessionManager(deps);
    const state = mgr.getSessionState('no-such-conv');
    expect(state.lifecycle).toBe('closed');
    expect(state.activeTurn).toBeNull();
  });

  it('maps conversation to correct machine when routing multiple conversations', async () => {
    const fakeHost1 = new FakeAcpProcessHost();
    const fakeHost2 = new FakeAcpProcessHost();
    const acquireProcessHost = vi
      .fn()
      .mockResolvedValueOnce(fakeHost1)
      .mockResolvedValueOnce(fakeHost2);

    const deps = makeManagerDeps({ acquireProcessHost });
    const mgr = new AcpSessionManager(deps);

    await mgr.start(makeConversation({ conversationId: 'conv-local' }), 'ws-1', '/tmp', {
      kind: 'local',
    });
    await mgr.start(makeConversation({ conversationId: 'conv-ssh' }), 'ws-1', '/remote', {
      kind: 'ssh',
      connectionId: 'conn-1',
    });

    expect(mgr.isRunning('conv-local')).toBe(true);
    expect(mgr.isRunning('conv-ssh')).toBe(true);
    expect(mgr.getChatHistory('conv-local')).toBeDefined();
    expect(mgr.getChatHistory('conv-ssh')).toBeDefined();
  });
});
