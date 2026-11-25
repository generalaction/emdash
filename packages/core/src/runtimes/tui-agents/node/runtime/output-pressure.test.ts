import { ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { TuiAgentStartInput } from '#runtimes/tui-agents/api';
import type { AgentPluginHost, ResolvedTuiProvider } from '#services/agent-plugins/api/plugins';
import type { IExecutionContext } from '#services/exec/api';
import { FakePtySpawner, TestPressureSignal } from '#services/pty/testing';
import { createMemorySessionIntentStore } from '#services/session-intents/api';
import { TuiAgentsRuntime } from './runtime';

describe('TuiAgentsRuntime output pressure', () => {
  it('forwards viewer pressure to the PTY and resumes on unsubscribe', async () => {
    const { runtime, spawner } = createRuntime();

    try {
      await runtime.startSession(startInput());

      const process = spawner.processes[0]!;
      if (!process) throw new Error('PTY process was not spawned');

      const pressure = new TestPressureSignal();
      const output = runtime.outputLog({ conversationId: 'conversation-1' });
      const unsubscribe = await output.subscribe(() => {}, { pressure });

      pressure.set(true);
      expect(process.pauseCalls).toBe(1);
      expect(process.resumeCalls).toBe(0);

      pressure.set(false);
      expect(process.pauseCalls).toBe(1);
      expect(process.resumeCalls).toBe(1);

      pressure.set(true);
      expect(process.pauseCalls).toBe(2);

      unsubscribe();

      expect(process.pauseCalls).toBe(2);
      expect(process.resumeCalls).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });
});

function createRuntime() {
  const spawner = new FakePtySpawner();
  const hooks = { kind: 'none' as const };
  const provider: ResolvedTuiProvider = {
    name: 'Test Agent',
    prompt: { kind: 'argv' },
    hooks,
    buildCommand: () => ({ command: 'agent', args: ['run'], env: {} }),
  };
  const agentHost = {
    homeDir: '/home/test-user',
    resolveTuiProvider: vi.fn(() => provider),
    get: vi.fn(() => ({
      capabilities: { hooks },
      behavior: {},
    })),
    buildPromptCommand: vi.fn(() =>
      Promise.resolve(
        ok({
          command: 'agent',
          args: ['run', 'hello world'],
          env: { AGENT: '1' },
        })
      )
    ),
  } as unknown as AgentPluginHost;
  const exec = {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
    execStreaming: vi.fn(() => Promise.resolve({ exitCode: 0 })),
    dispose: vi.fn(),
  } satisfies IExecutionContext;

  const runtime = new TuiAgentsRuntime({
    agentHost,
    env: async () => ({ PATH: '/bin', SHELL: '/bin/bash' }),
    exec,
    intents: createMemorySessionIntentStore(),
    spawner,
    logger: noopLogger,
  });

  return { runtime, spawner };
}

function startInput(overrides: Partial<TuiAgentStartInput> = {}): TuiAgentStartInput {
  return {
    conversationId: 'conversation-1',
    providerId: 'test',
    cwd: '/workspace',
    sessionId: null,
    model: null,
    initialPrompt: 'hello',
    cols: 120,
    rows: 30,
    ...overrides,
  };
}
