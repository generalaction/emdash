import { describe, expect, it, vi } from 'vitest';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { createLifecycleScriptTerminalId } from '@shared/terminals';
import type { Pty, PtyExitInfo } from '../pty/pty';
import type { LifecycleScriptSpawnRequest, TerminalProvider } from '../terminals/terminal-provider';
import { LifecycleScriptService } from './workspace-lifecycle-service';

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
  requests: LifecycleScriptSpawnRequest[];
} {
  const spawned: FakePty[] = [];
  const requests: LifecycleScriptSpawnRequest[] = [];
  const provider: TerminalProvider = {
    kind: 'local',
    async spawnTerminal() {},
    async spawnLifecycleScript(request) {
      const { terminal } = request;
      const pty = new FakePty();
      spawned.push(pty);
      requests.push(request);
      ptySessionRegistry.register(`${terminal.projectId}:${terminal.taskId}:${terminal.id}`, pty, {
        preserveBufferOnExit: true,
      });
    },
    async killTerminal() {},
    async destroyAll() {},
    async detachAll() {},
  };

  return { provider, spawned, requests };
}

describe('WorkspaceLifecycleService', () => {
  it('respawns an interactive lifecycle shell after an exit-backed script finishes', async () => {
    const { provider, spawned, requests } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-1',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.prepareLifecycleScript({ type: 'run', script: 'pnpm dev' });
    await service.runLifecycleScript({ type: 'run', script: 'pnpm dev' }, { exit: true });

    expect(spawned).toHaveLength(1);
    expect(requests[0].terminal.id).toBe(createLifecycleScriptTerminalId('run'));
    expect(spawned[0].writes).toEqual(['pnpm dev; exit\n']);

    spawned[0].emitExit({ exitCode: 0 });

    await expect.poll(() => spawned.length).toBe(2);
    expect(spawned[1].writes).toEqual([]);
  });

  it('keeps the same lifecycle PTY when the script text changes', async () => {
    const { provider, spawned, requests } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-2',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.runLifecycleScript({ type: 'run', script: 'pnpm dev' }, { exit: true });
    await service.runLifecycleScript({ type: 'run', script: 'pnpm start' }, { exit: true });

    expect(spawned).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].terminal.id).toBe(createLifecycleScriptTerminalId('run'));
    expect(spawned[0].writes).toEqual(['pnpm dev; exit\n', 'pnpm start; exit\n']);
  });

  it('respawns with the latest shell setup after repeated exit-backed runs', async () => {
    const { provider, spawned, requests } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-3',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.runLifecycleScript(
      { type: 'run', script: 'pnpm dev', shellSetup: 'source old-env' },
      { exit: true }
    );
    await service.runLifecycleScript(
      { type: 'run', script: 'pnpm dev', shellSetup: 'source new-env' },
      { exit: true }
    );

    spawned[0].emitExit({ exitCode: 0 });

    await expect.poll(() => spawned.length).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[1].shellSetup).toBe('source new-env');
  });
});
