import { afterEach, describe, expect, it, vi } from 'vitest';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { createLifecycleScriptTerminalId } from '@shared/core/terminals/terminals';
import type { Pty, PtyExitInfo } from '../pty/pty';
import type { LifecycleScriptSpawnRequest, TerminalProvider } from '../terminals/terminal-provider';
import { LifecycleScriptService } from './workspace-lifecycle-service';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
  },
}));

class FakePty implements Pty {
  writes: string[] = [];
  writeExitHandlerCounts: number[] = [];
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  write(data: string): void {
    this.writeExitHandlerCounts.push(this.exitHandlers.length);
    this.writes.push(data);
  }

  resize(): void {}

  kill(): void {
    this.emitExit({ signal: 'SIGTERM' });
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const handler of this.exitHandlers) {
      handler(info);
    }
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) {
      handler(data);
    }
  }
}

function mockPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
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
  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('respawns an interactive lifecycle shell after an exit-backed script finishes', async () => {
    mockPlatform('win32');
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
    expect(requests[0].command).toBeUndefined();
    expect(spawned[0].writes).toEqual(['pnpm dev\rexit\r']);

    spawned[0].emitExit({ exitCode: 0 });

    await expect.poll(() => spawned.length).toBe(2);
    expect(spawned[1].writes).toEqual([]);
  });

  it('does not prepare a second lifecycle shell when one is already active', async () => {
    const { provider, spawned, requests } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-prepare',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.prepareLifecycleScript({ type: 'run', script: 'pnpm dev' });
    await service.prepareLifecycleScript({ type: 'run', script: 'pnpm dev' });

    expect(spawned).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('keeps the same lifecycle PTY when the script text changes', async () => {
    mockPlatform('win32');
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
    expect(requests[0].command).toBeUndefined();
    expect(spawned[0].writes).toEqual(['pnpm dev\rexit\r', 'pnpm start\rexit\r']);
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

  it('resolves waitForExit when an exit-backed script exits successfully', async () => {
    mockPlatform('win32');
    const { provider, spawned, requests } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-4',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    const runPromise = service.runLifecycleScript(
      { type: 'setup', script: 'pnpm install' },
      { exit: true, waitForExit: true }
    );

    await expect.poll(() => spawned).toHaveLength(1);
    expect(requests[0].command).toBeUndefined();
    expect(spawned[0].writes).toEqual(['pnpm install\rexit\r']);
    expect(spawned[0].writeExitHandlerCounts[0]).toBeGreaterThan(1);

    spawned[0].emitExit({ exitCode: 0 });

    await expect(runPromise).resolves.toEqual({
      kind: 'exited',
      exitCode: 0,
      signal: undefined,
      outputTail: '',
    });
    expect(spawned).toHaveLength(1);
  });

  it('does not attach another awaited execution to a PTY that is already running', async () => {
    mockPlatform('win32');
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-concurrent',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    const firstRun = service.runLifecycleScript(
      { type: 'setup', script: 'pnpm install' },
      { exit: true, waitForExit: true }
    );

    await expect.poll(() => spawned).toHaveLength(1);
    expect(spawned[0].writes).toEqual(['pnpm install\rexit\r']);

    await expect(
      service.runLifecycleScript(
        { type: 'setup', script: 'pnpm install' },
        { exit: true, waitForExit: true }
      )
    ).resolves.toEqual({ kind: 'already-running' });
    expect(spawned[0].writes).toEqual(['pnpm install\rexit\r']);

    spawned[0].emitExit({ exitCode: 0 });
    await expect(firstRun).resolves.toMatchObject({ kind: 'exited', exitCode: 0 });
  });

  it('can restore an interactive lifecycle shell after an awaited script exits', async () => {
    mockPlatform('win32');
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-6',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    const runPromise = service.runLifecycleScript(
      { type: 'run', script: 'pnpm dev' },
      { exit: true, waitForExit: true, respawnAfterExit: true }
    );

    await expect.poll(() => spawned).toHaveLength(1);
    expect(spawned[0].writes).toEqual(['pnpm dev\rexit\r']);

    spawned[0].emitExit({ exitCode: 0 });

    await expect(runPromise).resolves.toMatchObject({
      kind: 'exited',
      exitCode: 0,
    });
    await expect.poll(() => spawned.length).toBe(2);
    expect(spawned[1].writes).toEqual([]);
  });

  it('can restore an interactive lifecycle shell after an awaited script is stopped', async () => {
    mockPlatform('win32');
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-7',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    const runPromise = service.runLifecycleScript(
      { type: 'run', script: 'pnpm dev' },
      { exit: true, waitForExit: true, respawnAfterExit: true }
    );

    await expect.poll(() => spawned).toHaveLength(1);
    expect(spawned[0].writes).toEqual(['pnpm dev\rexit\r']);

    spawned[0].kill();

    await expect(runPromise).resolves.toMatchObject({
      kind: 'exited',
      signal: 'SIGTERM',
    });
    await expect.poll(() => spawned.length).toBe(2);
    expect(spawned[1].writes).toEqual([]);
  });

  it('returns the output tail when an exit-backed script fails', async () => {
    mockPlatform('win32');
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-5',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    const runPromise = service.runLifecycleScript(
      { type: 'setup', script: 'pnpm install' },
      { exit: true, waitForExit: true }
    );

    await expect.poll(() => spawned).toHaveLength(1);
    expect(spawned[0].writes).toEqual(['pnpm install\rexit\r']);

    spawned[0].emitData('\u001b[31mdependency failed\u001b[0m\r\n');
    spawned[0].emitExit({ exitCode: 1 });

    await expect(runPromise).resolves.toMatchObject({
      kind: 'exited',
      exitCode: 1,
      outputTail: 'dependency failed\n',
    });
  });

  it('submits scripts to an existing lifecycle shell with terminal carriage returns', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-existing-shell',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.prepareLifecycleScript({ type: 'setup', script: 'echo one' });
    await service.runLifecycleScript({ type: 'setup', script: 'echo one' }, { exit: false });

    expect(spawned[0].writes).toEqual(['echo one\r']);
  });

  it('preserves same-line exit semantics outside local Windows shells', async () => {
    mockPlatform('linux');
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-posix',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.runLifecycleScript(
      { type: 'setup', script: 'pnpm install' },
      { exit: true }
    );

    expect(spawned[0].writes).toEqual(['pnpm install; exit\r']);
  });
});
