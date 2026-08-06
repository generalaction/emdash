import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loopPhaseUpdatedChannel, loopUpdatedChannel } from '@shared/core/loops/loopEvents';
import type { LoopWithPhases } from '@shared/core/loops/loops';
import { mapLoopTabSnapshot, RpcLoopAuthoringPort } from './loop-authoring-rpc-port';

const mocks = vi.hoisted(() => ({
  getLoop: vi.fn(),
  startLoop: vi.fn(),
  pauseLoop: vi.fn(),
  resumeLoop: vi.fn(),
  retryPhase: vi.fn(),
  listeners: new Map<string, (value: never) => void>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    loops: {
      getLoop: mocks.getLoop,
      startLoop: mocks.startLoop,
      pauseLoop: mocks.pauseLoop,
      resumeLoop: mocks.resumeLoop,
      retryPhase: mocks.retryPhase,
    },
  },
  events: {
    on: vi.fn((event: { name: string }, listener: (value: never) => void) => {
      mocks.listeners.set(event.name, listener);
      return () => mocks.listeners.delete(event.name);
    }),
  },
}));

function makeLoop(): LoopWithPhases {
  return {
    id: 'loop-1',
    projectId: 'project-1',
    taskId: 'task-1',
    name: 'Feature Loop',
    slug: 'feature-loop',
    status: 'running',
    currentPhaseIndex: 1,
    isPrimary: true,
    config: {
      version: '2',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      validationCommands: ['pnpm test'],
      planSource: '## Build',
      terminalGates: { review: false, e2e: true },
      browserPreview: { enabled: true },
      reviewEnabled: false,
      verifiers: [],
    },
    state: {
      version: '2',
      baseCommit: null,
      expectedFeatureHead: null,
      checkpointCommit: null,
      e2eAttemptsConsumed: 1,
      sessionAttempts: [],
      verification: null,
    },
    phases: [
      {
        id: 'phase-1',
        loopId: 'loop-1',
        idx: 0,
        kind: 'work',
        name: 'Build',
        goal: 'Build it',
        status: 'passed',
        attempts: 1,
        conversationId: 'conversation-1',
        criteria: { version: '1', criteria: [] },
        lastError: null,
        state: {
          version: '2',
          checkpointCommit: 'a'.repeat(40),
          handoff: {
            summary: 'Built it',
            risks: [],
            remainingWork: [],
            artifacts: [
              {
                artifactId: 'artifact-1',
                kind: 'test-report',
                label: 'Tests',
                byteLength: 42,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          retryHandoffs: [],
          result: {
            status: 'passed',
            summary: 'Built it',
            completedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'phase-2',
        loopId: 'loop-1',
        idx: 1,
        kind: 'e2e',
        name: 'E2E',
        goal: 'Verify it',
        status: 'pending',
        attempts: 0,
        conversationId: null,
        criteria: {
          version: '1',
          criteria: [
            { description: 'The page renders', verifier: 'agent-browser', status: 'pending' },
          ],
        },
        lastError: null,
        state: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('RpcLoopAuthoringPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.getLoop.mockResolvedValue({ success: true, data: makeLoop() });
    mocks.startLoop.mockResolvedValue({ success: true, data: makeLoop() });
  });

  it('maps only bounded handoff and evidence metadata into the task tab', () => {
    const snapshot = mapLoopTabSnapshot(makeLoop());

    expect(snapshot.browser).toEqual({
      kind: 'waiting',
      message: 'Waiting for the clean-room E2E phase.',
    });
    expect(snapshot.phases[0]?.handoff?.artifacts).toEqual([
      { artifactId: 'artifact-1', kind: 'test-report', label: 'Tests', byteLength: 42 },
    ]);
    expect(snapshot.phases[1]?.evidence).toEqual([
      {
        label: 'The page renders',
        status: 'pending',
        summary: 'Criterion is pending.',
      },
    ]);
  });

  it('reloads the authoritative snapshot for matching Loop and phase events', async () => {
    const port = new RpcLoopAuthoringPort();
    const listener = vi.fn();
    const dispose = port.subscribeToLoop('loop-1', listener);
    await vi.waitFor(() => expect(mocks.listeners.size).toBe(2));

    mocks.listeners.get(loopUpdatedChannel.name)?.({ loop: makeLoop() } as never);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    mocks.listeners.get(loopPhaseUpdatedChannel.name)?.({ loopId: 'other' } as never);
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    expect(mocks.listeners.size).toBe(0);
  });

  it('starts a draft Loop through the production RPC', async () => {
    const port = new RpcLoopAuthoringPort();

    await expect(port.startLoop('loop-1')).resolves.toMatchObject({
      loopId: 'loop-1',
      status: 'running',
    });
    expect(mocks.startLoop).toHaveBeenCalledWith('loop-1');
  });
});
