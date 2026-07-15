import { createScope } from '@emdash/shared/concurrency';
import { createManualClock } from '@emdash/shared/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import {
  hostFileRef,
  parseAbsolute,
  resourceKeyFromFileRef,
  type HostFileRef,
} from '@primitives/path/api';
import type { PtyExitInfo, PtyProcess, PtySpawnSpec, PtySpawner } from '@services/pty/api';
import { describe, expect, it } from 'vitest';
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
