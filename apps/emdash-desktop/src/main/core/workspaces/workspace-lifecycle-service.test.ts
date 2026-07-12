import { err, ok } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import type { TerminalShellFamily } from '@shared/core/terminals/terminal-settings';
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
  killCalls = 0;
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  write(data: string): void {
    this.writeExitHandlerCounts.push(this.exitHandlers.length);
    this.writes.push(data);
  }

  resize(): void {}

  kill(): void {
    this.killCalls += 1;
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

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function makeTerminalProvider(shellFamily: TerminalShellFamily = 'windows-cmd'): {
  provider: TerminalProvider;
  spawned: FakePty[];
  requests: LifecycleScriptSpawnRequest[];
  destroyAll: ReturnType<typeof vi.fn>;
} {
  const spawned: FakePty[] = [];
  const requests: LifecycleScriptSpawnRequest[] = [];
  const destroyAll = vi.fn(async () => {});
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
    async getLifecycleScriptShellFamily() {
      return shellFamily;
    },
    async killTerminal() {},
    destroyAll,
    async detachAll() {},
  };

  return { provider, spawned, requests, destroyAll };
}

describe('WorkspaceLifecycleService', () => {
  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it.each(['setup', 'run'] as const)(
    'quiesces a late required %s spawn without writing a command',
    async (type) => {
      const { provider, spawned, destroyAll } = makeTerminalProvider();
      const spawn = provider.spawnLifecycleScript.bind(provider);
      const gate = deferred();
      const spawnStarted = deferred();
      provider.spawnLifecycleScript = async (request) => {
        spawnStarted.resolve();
        await gate.promise;
        await spawn(request);
      };
      const service = new LifecycleScriptService({
        projectId: `project-held-${type}`,
        workspaceId: `loop-held-${type}`,
        terminals: provider,
      });
      vi.useFakeTimers();
      try {
        const receipt = service.startRequiredStartup({
          [type]: { type, script: type === 'setup' ? 'pnpm install' : 'pnpm dev' },
          deadlineAt: Date.now() + 60_000,
        });
        let settled = false;
        void receipt.ready.then(() => {
          settled = true;
        });

        await spawnStarted.promise;
        await vi.advanceTimersByTimeAsync(60_001);
        expect(settled).toBe(false);

        gate.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await expect(receipt.ready).resolves.toMatchObject({
          success: false,
          error: { type: 'cancelled', stage: type },
        });
        expect(spawned).toHaveLength(1);
        expect(spawned[0].writes).toEqual([]);
        expect(spawned[0].killCalls).toBeGreaterThanOrEqual(1);
        expect(destroyAll).toHaveBeenCalled();
      } finally {
        gate.resolve();
        vi.useRealTimers();
      }
    }
  );

  it('caps a non-exiting setup by the absolute deadline and drains its PTY', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-absolute-setup',
      workspaceId: 'loop-absolute-setup',
      terminals: provider,
    });
    const receipt = service.startRequiredStartup({
      setup: { type: 'setup', script: 'pnpm install' },
      setupTimeoutMs: 60_000,
      deadlineAt: Date.now() + 20,
    });
    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm install; exit\n']);

    await expect(receipt.ready).resolves.toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'setup' },
    });
    expect(spawned[0].killCalls).toBeGreaterThanOrEqual(1);
  });

  it('cancels an ignored preview waiter at the absolute deadline and drains the run PTY', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-absolute-preview',
      workspaceId: 'loop-absolute-preview',
      terminals: provider,
    });
    const receipt = service.startRequiredStartup({
      run: { type: 'run', script: 'pnpm dev' },
      deadlineAt: Date.now() + 20,
      waitForPreview: async () => new Promise(() => {}),
    });
    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm dev; exit\n']);

    await expect(receipt.ready).resolves.toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'preview' },
    });
    expect(spawned[0].killCalls).toBeGreaterThanOrEqual(1);
  });

  it('disarms external creation controls after readiness while retaining receipt cancellation', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const caller = new AbortController();
    const service = new LifecycleScriptService({
      projectId: 'project-deadline-disarm',
      workspaceId: 'loop-deadline-disarm',
      terminals: provider,
    });
    const receipt = service.startRequiredStartup({
      run: { type: 'run', script: 'pnpm dev' },
      signal: caller.signal,
      deadlineAt: Date.now() + 30,
      runStartupGraceMs: 1,
    });

    await expect(receipt.ready).resolves.toMatchObject({ success: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    caller.abort();
    expect(spawned[0].killCalls).toBe(0);

    receipt.cancel();
    expect(spawned[0].killCalls).toBe(1);
    await service.dispose();
  });

  it('returns a strict startup receipt after setup and preview readiness without waiting for run exit', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-startup',
      workspaceId: 'loop-verification-1',
      terminals: provider,
    });
    let resolvePreview: (() => void) | undefined;
    const previewReady = new Promise<void>((resolve) => {
      resolvePreview = resolve;
    });

    const receipt = service.startRequiredStartup({
      setup: { type: 'setup', script: 'pnpm install' },
      run: { type: 'run', script: 'pnpm dev' },
      waitForPreview: async () => {
        await previewReady;
        return ok();
      },
    });

    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm install; exit\n']);
    spawned[0].emitExit({ exitCode: 0 });
    await expect.poll(() => spawned[1]?.writes).toEqual(['pnpm dev; exit\n']);
    resolvePreview?.();

    await expect(receipt.ready).resolves.toEqual({
      success: true,
      data: { setup: 'succeeded', run: 'running', preview: 'ready' },
    });
    expect(spawned[1]).toBeDefined();
    receipt.cancel();
    expect(spawned[1].killCalls).toBe(1);
    await service.dispose();
  });

  it('fails strict startup when the required run exits before preview readiness', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-early-exit',
      workspaceId: 'loop-verification-2',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      run: { type: 'run', script: 'pnpm dev' },
      waitForPreview: async () => new Promise(() => {}),
    });

    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm dev; exit\n']);
    spawned[0].emitData('server crashed\n');
    spawned[0].emitExit({ exitCode: 1 });

    await expect(receipt.ready).resolves.toEqual({
      success: false,
      error: {
        type: 'run-exited',
        stage: 'run',
        message: 'Run script exited before required readiness.',
      },
    });
  });

  it('does not wait for a URL for a CLI-only startup with no run script', async () => {
    const { provider } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-cli',
      workspaceId: 'loop-verification-3',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({});

    await expect(receipt.ready).resolves.toEqual({
      success: true,
      data: { setup: 'not-configured', run: 'not-configured', preview: 'not-required' },
    });
  });

  it('returns a typed preview failure and kills the required run', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-preview-failure',
      workspaceId: 'loop-verification-4',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      run: { type: 'run', script: 'pnpm dev' },
      waitForPreview: async () =>
        err({
          type: 'preview-timeout',
          stage: 'preview',
          message: 'Preview did not become ready before the timeout.',
        }),
    });

    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm dev; exit\n']);
    await expect(receipt.ready).resolves.toEqual({
      success: false,
      error: {
        type: 'preview-timeout',
        stage: 'preview',
        message: 'Preview did not become ready before the timeout.',
      },
    });
    await expect.poll(() => spawned.length).toBe(1);
    expect(spawned[0].killCalls).toBe(1);
  });

  it('aborts strict setup and disposes its lifecycle terminal deterministically', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const abort = new AbortController();
    const service = new LifecycleScriptService({
      projectId: 'project-abort',
      workspaceId: 'loop-verification-5',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      setup: { type: 'setup', script: 'pnpm install' },
      signal: abort.signal,
    });
    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm install; exit\n']);

    abort.abort();

    await expect(receipt.ready).resolves.toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'setup' },
    });
    expect(spawned[0].killCalls).toBe(1);
  });

  it.each([
    { exit: { exitCode: 1 }, label: 'non-zero exit' },
    { exit: { signal: 'SIGKILL' }, label: 'signal' },
  ] as const)('fails strict setup on $label', async ({ exit, label }) => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-setup-failure',
      workspaceId: `loop-verification-${label}`,
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      setup: { type: 'setup', script: 'pnpm install' },
    });
    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm install; exit\n']);
    spawned[0].emitExit(exit);

    await expect(receipt.ready).resolves.toEqual({
      success: false,
      error: {
        type: 'setup-failed',
        stage: 'setup',
        message: 'Setup script did not complete successfully.',
      },
    });
  });

  it('returns a typed failure when the required run PTY cannot spawn', async () => {
    const { provider } = makeTerminalProvider();
    provider.spawnLifecycleScript = vi.fn(async () => {
      throw new Error('spawn failed');
    });
    const service = new LifecycleScriptService({
      projectId: 'project-run-spawn',
      workspaceId: 'loop-verification-run-spawn',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      run: { type: 'run', script: 'pnpm dev' },
    });

    await expect(receipt.ready).resolves.toEqual({
      success: false,
      error: {
        type: 'run-start-failed',
        stage: 'run',
        message: 'Run script failed to start.',
      },
    });
  });

  it('times out strict setup, kills it, and returns a typed timeout', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-setup-timeout',
      workspaceId: 'loop-verification-setup-timeout',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      setup: { type: 'setup', script: 'pnpm install' },
      setupTimeoutMs: 1,
    });
    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm install; exit\n']);

    await expect(receipt.ready).resolves.toEqual({
      success: false,
      error: {
        type: 'setup-timeout',
        stage: 'setup',
        message: 'Setup script did not finish before the timeout.',
      },
    });
    expect(spawned[0].killCalls).toBe(1);
  });

  it('cancels even when a preview waiter ignores its signal and no run script exists', async () => {
    const { provider } = makeTerminalProvider();
    const abort = new AbortController();
    const service = new LifecycleScriptService({
      projectId: 'project-preview-abort',
      workspaceId: 'loop-verification-preview-abort',
      terminals: provider,
    });
    const receipt = service.startRequiredStartup({
      signal: abort.signal,
      waitForPreview: async () => new Promise(() => {}),
    });

    abort.abort();

    await expect(receipt.ready).resolves.toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'preview' },
    });
  });

  it('kills a lifecycle PTY whose command write throws', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const spawn = provider.spawnLifecycleScript.bind(provider);
    provider.spawnLifecycleScript = async (request) => {
      await spawn(request);
      spawned.at(-1)!.write = () => {
        throw new Error('write failed');
      };
    };
    const service = new LifecycleScriptService({
      projectId: 'project-write-failure',
      workspaceId: 'loop-verification-write-failure',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      run: { type: 'run', script: 'pnpm dev' },
    });

    await expect(receipt.ready).resolves.toMatchObject({
      success: false,
      error: { type: 'run-start-failed', stage: 'run' },
    });
    expect(spawned[0].killCalls).toBe(1);
  });

  it('classifies a thrown preview waiter as a preview failure', async () => {
    const { provider } = makeTerminalProvider();
    const service = new LifecycleScriptService({
      projectId: 'project-preview-throw',
      workspaceId: 'loop-verification-preview-throw',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      waitForPreview: async () => {
        throw new Error('preview unavailable');
      },
    });

    await expect(receipt.ready).resolves.toEqual({
      success: false,
      error: {
        type: 'preview-failed',
        stage: 'preview',
        message: 'Preview readiness failed unexpectedly.',
      },
    });
  });

  it('re-attests cancellation after a preview waiter reports ready', async () => {
    const { provider } = makeTerminalProvider();
    const abort = new AbortController();
    const service = new LifecycleScriptService({
      projectId: 'project-preview-ready-abort',
      workspaceId: 'loop-verification-preview-ready-abort',
      terminals: provider,
    });

    const receipt = service.startRequiredStartup({
      signal: abort.signal,
      waitForPreview: async () => {
        abort.abort();
        return ok();
      },
    });

    await expect(receipt.ready).resolves.toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'preview' },
    });
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
    mockPlatform('win32');
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

    await service.runLifecycleScript({ type: 'setup', script: 'pnpm install' }, { exit: true });

    expect(spawned[0].writes).toEqual(['pnpm install; exit\r']);
  });

  it('preserves same-line exit semantics for local WSL shells on Windows', async () => {
    mockPlatform('win32');
    const { provider, spawned } = makeTerminalProvider('wsl');
    const service = new LifecycleScriptService({
      projectId: 'project-wsl',
      workspaceId: 'branch:feature',
      terminals: provider,
    });

    await service.runLifecycleScript({ type: 'setup', script: 'pnpm install' }, { exit: true });

    expect(spawned[0].writes).toEqual(['pnpm install; exit\r']);
  });
});
