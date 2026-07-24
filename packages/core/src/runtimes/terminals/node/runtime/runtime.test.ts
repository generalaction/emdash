import { createScope } from '@emdash/shared/concurrency';
import { noopLogger } from '@emdash/shared/logger';
import { createManualClock } from '@emdash/shared/testing';
import type { IExecutionContext } from '@primitives/exec/api';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import {
  hostFileRef,
  parseAbsolute,
  resourceKeyFromFileRef,
  type HostFileRef,
} from '@primitives/path/api';
import type {
  ResolvedShellProfile,
  ShellFallbackEvent,
  TerminalShellAvailability,
  TerminalShellId,
  TerminalShellResolver,
} from '@primitives/terminal-shell/api';
import type { PtyExitInfo, PtyProcess, PtySpawnSpec, PtySpawner } from '@services/pty/api';
import { describe, expect, it, vi } from 'vitest';
import { TerminalsRuntime } from './runtime';

class FakePtyProcess implements PtyProcess {
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  private exited = false;

  constructor(readonly pid: number) {}

  write(_data: string): void {}

  resize(_cols: number, _rows: number): void {}

  kill(): void {
    this.exit({ exitCode: null, signal: 'SIGTERM' });
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  getPid(): number {
    return this.pid;
  }

  get isExited(): boolean {
    return this.exited;
  }

  emit(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  exit(info: PtyExitInfo): void {
    if (this.exited) return;
    this.exited = true;
    for (const handler of this.exitHandlers) handler(info);
  }
}

class FakePtySpawner implements PtySpawner {
  readonly specs: PtySpawnSpec[] = [];
  readonly processes: FakePtyProcess[] = [];

  spawn(spec: PtySpawnSpec): PtyProcess {
    this.specs.push(spec);
    const process = new FakePtyProcess(this.processes.length + 1);
    this.processes.push(process);
    return process;
  }
}

function posixShellProfile(overrides: Partial<ResolvedShellProfile> = {}): ResolvedShellProfile {
  return {
    id: 'zsh',
    resolvedShellId: 'zsh',
    resolvedFromSystem: false,
    executable: '/usr/bin/zsh',
    available: true,
    family: 'posix',
    interactiveArgs: ['-il'],
    commandArgs: ['-lc'],
    ...overrides,
  };
}

class FakeShellResolver implements TerminalShellResolver {
  readonly resolveCalls: TerminalShellId[] = [];

  constructor(
    private readonly options: {
      profile?: ResolvedShellProfile;
      availability?: TerminalShellAvailability[];
      fallback?: ShellFallbackEvent;
      availabilityError?: Error;
    } = {}
  ) {}

  async resolveWithSystemFallback(input: {
    intent: TerminalShellId;
    onFallback?: (event: ShellFallbackEvent) => void;
  }): Promise<ResolvedShellProfile> {
    this.resolveCalls.push(input.intent);
    if (this.options.fallback) input.onFallback?.(this.options.fallback);
    return this.options.profile ?? posixShellProfile();
  }

  async getAvailability(): Promise<TerminalShellAvailability[]> {
    if (this.options.availabilityError) throw this.options.availabilityError;
    return this.options.availability ?? [];
  }
}

describe('TerminalsRuntime', () => {
  it('runs a script workflow node in a PTY and publishes retained state', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, scope, now: () => 1000 });
    const workspace = testWorkspace();
    const promise = runtime.runWorkflow(
      {
        workspace,
        kind: 'manual:setup',
        nodes: [
          {
            id: 'setup',
            label: 'Setup',
            command: 'pnpm install',
            cwd: '/repo',
            env: {},
          },
        ],
      },
      liveJobContext('job-1')
    );

    await waitFor(() => spawner.processes.length === 1);
    spawner.processes[0]!.emit('installing\n');
    spawner.processes[0]!.exit({ exitCode: 0, signal: null });

    await expect(promise).resolves.toMatchObject({
      success: true,
      data: { completedNodes: ['setup'] },
    });
    expect(runtime.workflowsHost.get({ workspace })?.states.state.snapshot().data).toMatchObject({
      workflowId: 'job-1',
      kind: 'manual:setup',
      phase: 'succeeded',
      nodes: {
        setup: {
          status: 'done',
          pid: 1,
          awaitingOn: [],
          exit: { exitCode: 0, signal: null },
        },
      },
    });
    const output = (await runtime.outputLog({ workspace, id: 'setup' }).snapshot()).data as {
      text: string;
    };
    expect(output.text).toContain('installing');

    await scope.dispose();
  });

  it('rejects overlapping different workflow kinds for the same workspace', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, scope });
    const workspace = testWorkspace();
    const first = runtime.runWorkflow(
      {
        workspace,
        kind: 'manual:setup',
        nodes: [{ id: 'setup', command: 'echo setup', cwd: '/repo', env: {} }],
      },
      liveJobContext('job-1')
    );
    await waitFor(() => spawner.processes.length === 1);

    await expect(
      runtime.runWorkflow(
        {
          workspace,
          kind: 'teardown',
          nodes: [{ id: 'teardown', command: 'echo teardown', cwd: '/repo', env: {} }],
        },
        liveJobContext('job-2')
      )
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'workflow-in-flight' },
    });

    spawner.processes[0]!.exit({ exitCode: 0, signal: null });
    await first;
    await scope.dispose();
  });

  it('publishes detected dev servers and prunes them when the session exits', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({
      spawner,
      scope,
      now: () => 1000,
      portProbe: async () => true,
    });
    const workspace = testWorkspace();
    const run = runtime.runWorkflow(
      {
        workspace,
        kind: 'manual:run',
        nodes: [{ id: 'run', command: 'pnpm dev', cwd: '/repo', env: {} }],
      },
      liveJobContext('job-1')
    );
    await waitFor(() => spawner.processes.length === 1);

    spawner.processes[0]!.emit('ready at http://localhost:5173/app\n');

    await waitFor(() => Object.keys(devServers(runtime)).length === 1);
    expect(devServers(runtime)).toEqual({
      [`${workspaceKey(workspace)}:run:http::5173`]: {
        key: { workspace, id: 'run' },
        protocol: 'http:',
        host: 'localhost',
        port: 5173,
        urlPath: '/app',
        detectedAt: 1000,
      },
    });

    spawner.processes[0]!.exit({ exitCode: 0, signal: null });
    await run;
    await waitFor(() => Object.keys(devServers(runtime)).length === 0);
    await scope.dispose();
  });

  it('prunes detected dev servers when a scope is killed', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({
      spawner,
      scope,
      portProbe: async () => true,
    });
    const workspace = testWorkspace();
    const run = runtime.runWorkflow(
      {
        workspace,
        kind: 'manual:run',
        nodes: [{ id: 'run', command: 'pnpm dev', cwd: '/repo', env: {} }],
      },
      liveJobContext('job-1')
    );
    await waitFor(() => spawner.processes.length === 1);
    spawner.processes[0]!.emit('ready at http://localhost:5173/app\n');
    await waitFor(() => Object.keys(devServers(runtime)).length === 1);

    await runtime.killScope(workspace);

    await waitFor(() => Object.keys(devServers(runtime)).length === 0);
    await run;
    await scope.dispose();
  });

  it('kills detached interactive terminals after the configured grace period', async () => {
    const clock = createManualClock(0);
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({
      spawner,
      scope,
      clock,
      lifecycle: {
        terminal: { kind: 'while-attached', graceMs: 1_000 },
        sweepIntervalMs: 100,
      },
    });
    const workspace = testWorkspace();
    const key = { workspace, id: 'terminal-1' };
    await runtime.startTerminal({ key, spec: { cwd: '/repo', env: {} } });
    const unsubscribe = await runtime.outputLog(key).subscribe(() => {});
    unsubscribe();

    await clock.advanceBy(1_200);

    expect(spawner.processes[0]!.isExited).toBe(true);
    await scope.dispose();
  });

  it('killTmuxSessions calls killTmuxSession for each session name', async () => {
    const exec = fakeExec();
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, exec, scope });

    const result = await runtime.killTmuxSessions({
      sessionNames: ['emdash-session1', 'emdash-session2'],
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(exec.exec).toHaveBeenCalledTimes(2);
    expect(exec.exec).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'emdash-session1']);
    expect(exec.exec).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'emdash-session2']);
    await scope.dispose();
  });

  it('killTmuxSessions succeeds even when sessions are missing', async () => {
    const exec = fakeExec();
    exec.exec.mockRejectedValue(new Error('no session'));
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, exec, scope });

    const result = await runtime.killTmuxSessions({
      sessionNames: ['emdash-missing'],
    });

    expect(result).toEqual({ success: true, data: undefined });
    await scope.dispose();
  });

  it('killTmuxSessions returns ok without calling exec when no exec is injected', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, scope });

    const result = await runtime.killTmuxSessions({
      sessionNames: ['emdash-session1'],
    });

    expect(result).toEqual({ success: true, data: undefined });
    await scope.dispose();
  });

  it('listTmuxSessions returns parsed session activity', async () => {
    const exec = fakeExec();
    exec.exec.mockResolvedValue({
      stdout: 'emdash-aaa\t1700000000\nemdash-bbb\t1700000100\n',
      stderr: '',
    });
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, exec, scope });

    const result = await runtime.listTmuxSessions();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([
        { sessionName: 'emdash-aaa', activityMs: 1700000000_000 },
        { sessionName: 'emdash-bbb', activityMs: 1700000100_000 },
      ]);
    }
    await scope.dispose();
  });

  it('listTmuxSessions returns empty when no tmux server is running', async () => {
    const exec = fakeExec();
    const error = Object.assign(new Error('no server running on /tmp/tmux'), {
      exitCode: 1,
      stderr: 'no server running on /tmp/tmux',
    });
    exec.exec.mockRejectedValue(error);
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, exec, scope });

    const result = await runtime.listTmuxSessions();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
    await scope.dispose();
  });

  it('listTmuxSessions returns empty when no exec is injected', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, scope });

    const result = await runtime.listTmuxSessions();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
    await scope.dispose();
  });

  it('keeps completable workflow nodes while reaping background nodes by policy', async () => {
    const clock = createManualClock(0);
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({
      spawner,
      scope,
      clock,
      lifecycle: {
        backgroundScript: { kind: 'while-attached', graceMs: 1_000 },
        sweepIntervalMs: 100,
      },
    });
    const workspace = testWorkspace();
    const completable = runtime.runWorkflow(
      {
        workspace,
        kind: 'manual:setup',
        nodes: [{ id: 'setup', command: 'pnpm install', cwd: '/repo', env: {} }],
      },
      liveJobContext('job-setup')
    );
    await waitFor(() => spawner.processes.length === 1);
    const background = runtime.runWorkflow(
      {
        workspace: hostFileRef(LOCAL_HOST_REF, parseAbsoluteWorkspace('/repo-2')),
        kind: 'manual:run',
        nodes: [
          {
            id: 'run',
            command: 'pnpm dev',
            cwd: '/repo-2',
            env: {},
            lifecycle: 'background',
          },
        ],
      },
      liveJobContext('job-run')
    );
    await waitFor(() => spawner.processes.length === 2);

    await clock.advanceBy(1_200);

    expect(spawner.processes[0]!.isExited).toBe(false);
    expect(spawner.processes[1]!.isExited).toBe(true);
    spawner.processes[0]!.exit({ exitCode: 0, signal: null });
    await completable;
    await background;
    await scope.dispose();
  });

  it('resolves shell intent on the runtime host and spawns the resolved shell', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const shellResolver = new FakeShellResolver({
      profile: posixShellProfile({ executable: '/opt/homebrew/bin/zsh' }),
    });
    const runtime = new TerminalsRuntime({ spawner, scope, shellResolver });
    const workspace = testWorkspace();

    await runtime.startTerminal({
      key: { workspace, id: 'terminal-1' },
      spec: { cwd: '/repo', env: {}, shellIntent: 'zsh' },
    });

    expect(shellResolver.resolveCalls).toEqual(['zsh']);
    expect(spawner.specs[0]!.command).toBe('/opt/homebrew/bin/zsh');
    expect(spawner.specs[0]!.args).toEqual(['-il']);
    await scope.dispose();
  });

  it('does not consult the shell resolver when no intent is provided', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const shellResolver = new FakeShellResolver();
    const runtime = new TerminalsRuntime({ spawner, scope, shellResolver });
    const workspace = testWorkspace();

    await runtime.startTerminal({
      key: { workspace, id: 'terminal-1' },
      spec: { cwd: '/repo', env: {} },
    });

    expect(shellResolver.resolveCalls).toEqual([]);
    await scope.dispose();
  });

  it('logs a fallback when the requested shell is unavailable on the host', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const warn = vi.fn();
    const shellResolver = new FakeShellResolver({
      profile: posixShellProfile({ id: 'target-default', resolvedFromSystem: true }),
      fallback: { shell: 'fish', message: 'fish is not available on this host' },
    });
    const runtime = new TerminalsRuntime({
      spawner,
      scope,
      shellResolver,
      logger: { ...noopLogger, warn },
    });
    const workspace = testWorkspace();

    await runtime.startTerminal({
      key: { workspace, id: 'terminal-1' },
      spec: { cwd: '/repo', env: {}, shellIntent: 'fish' },
    });

    expect(warn).toHaveBeenCalledWith(
      'terminals: falling back to system shell',
      expect.objectContaining({ terminalId: 'terminal-1', shell: 'fish' })
    );
    await scope.dispose();
  });

  it('returns host shell availability from the injected resolver', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const availability: TerminalShellAvailability[] = [
      { id: 'system', label: 'zsh', isSystemDefault: true, available: true },
      { id: 'bash', label: 'bash', isSystemDefault: false, available: true },
    ];
    const runtime = new TerminalsRuntime({
      spawner,
      scope,
      shellResolver: new FakeShellResolver({ availability }),
    });

    await expect(runtime.getShellAvailability()).resolves.toEqual({
      success: true,
      data: availability,
    });
    await scope.dispose();
  });

  it('fails shell availability when no resolver is configured', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals' });
    const runtime = new TerminalsRuntime({ spawner, scope });

    await expect(runtime.getShellAvailability()).resolves.toMatchObject({
      success: false,
      error: { type: 'shell-availability-failed' },
    });
    await scope.dispose();
  });
});

function liveJobContext(jobId: string) {
  return {
    jobId,
    signal: new AbortController().signal,
    progress: () => {},
  };
}

function testWorkspace(): HostFileRef {
  return hostFileRef(LOCAL_HOST_REF, parseAbsoluteWorkspace('/repo'));
}

function parseAbsoluteWorkspace(path: string) {
  const parsed = parseAbsolute(path, { profile: { style: 'posix' } });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

function fakeExec(): IExecutionContext & { exec: ReturnType<typeof vi.fn> } {
  return {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    execStreaming: vi.fn().mockResolvedValue({ exitCode: 0 }),
    dispose: vi.fn(),
  };
}

function devServers(runtime: TerminalsRuntime) {
  return runtime.devServersHost.get(undefined)?.states.list.snapshot().data ?? {};
}

function workspaceKey(workspace: HostFileRef): string {
  return resourceKeyFromFileRef(workspace);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for predicate');
}
