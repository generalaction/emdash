import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import type { Terminal } from '@shared/core/terminals/terminals';
import { LocalTerminalProvider } from './local-terminal-provider';

const ptyMock = vi.hoisted(() => ({
  exitHandlers: [] as Array<(info: PtyExitInfo) => void>,
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty: vi.fn(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn((handler: (info: PtyExitInfo) => void) => {
      ptyMock.exitHandlers.push(handler);
    }),
  })),
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('../dev-server-watcher', () => ({
  wireTerminalDevServerWatcher: vi.fn(),
}));

vi.mock('@main/core/pty/terminal-color-scheme', () => ({
  getTerminalColorEnv: vi.fn().mockResolvedValue({}),
}));

const terminal: Terminal = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  shellId: 'system',
  name: 'Terminal 1',
};

const ctx = {
  supportsLocalSpawn: true,
  exec: vi.fn(),
  execStreaming: vi.fn(),
  dispose: vi.fn(),
} satisfies IExecutionContext;

describe('LocalTerminalProvider', () => {
  beforeEach(() => {
    ptyMock.exitHandlers.length = 0;
    vi.mocked(ptySessionRegistry.register).mockClear();
  });

  it('registers user terminals with their display name for resource monitor labels', async () => {
    const provider = new LocalTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
    });

    await provider.spawnTerminal(terminal);

    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    expect(ptySessionRegistry.register).toHaveBeenCalledWith(
      sessionId,
      expect.anything(),
      expect.objectContaining({ metadata: { title: terminal.name } })
    );
  });

  it('cleans up cached shell profiles after a non-respawned exit', async () => {
    const provider = new LocalTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
    });

    await provider.spawnLifecycleScript({
      terminal,
      command: 'echo ready',
    });

    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    expect(
      (provider as unknown as { shellProfiles: Map<string, unknown> }).shellProfiles.has(sessionId)
    ).toBe(true);

    for (const handler of ptyMock.exitHandlers) handler({ exitCode: 0 });

    expect(
      (provider as unknown as { shellProfiles: Map<string, unknown> }).shellProfiles.has(sessionId)
    ).toBe(false);
  });
});
