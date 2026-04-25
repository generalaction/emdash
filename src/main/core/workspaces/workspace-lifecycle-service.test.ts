import { describe, expect, it, vi } from 'vitest';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import type { Pty, PtyExitInfo } from '../pty/pty';
import type { TerminalProvider } from '../terminals/terminal-provider';
import { WorkspaceLifecycleService } from './workspace-lifecycle-service';

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
  },
}));

class FakePty implements Pty {
  writes: string[] = [];
  private exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {}

  kill(): void {}

  onData(): void {}

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const handler of this.exitHandlers) {
      handler(info);
    }
  }
}

function makeTerminalProvider(): {
  provider: TerminalProvider;
  spawned: FakePty[];
} {
  const spawned: FakePty[] = [];
  const provider: TerminalProvider = {
    async spawnTerminal() {},
    async spawnLifecycleScript({ terminal }) {
      const pty = new FakePty();
      spawned.push(pty);
      ptySessionRegistry.register(`${terminal.projectId}:${terminal.taskId}:${terminal.id}`, pty, {
        preserveBufferOnExit: true,
      });
    },
    async killTerminal() {},
    async destroyAll() {},
    async detachAll() {},
  };

  return { provider, spawned };
}

describe('WorkspaceLifecycleService', () => {
  it('respawns an interactive lifecycle shell after an exit-backed script finishes', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new WorkspaceLifecycleService({
      projectId: 'project-1',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.prepareLifecycleScript({ type: 'run', script: 'pnpm dev' });
    await service.runLifecycleScript({ type: 'run', script: 'pnpm dev' }, { exit: true });

    expect(spawned).toHaveLength(1);
    expect(spawned[0].writes).toEqual(['pnpm dev; exit\n']);

    spawned[0].emitExit({ exitCode: 0 });

    await expect.poll(() => spawned.length).toBe(2);
    expect(spawned[1].writes).toEqual([]);
  });
});
