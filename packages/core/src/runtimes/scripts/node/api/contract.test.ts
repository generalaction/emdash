import { remote, snapshot } from '@emdash/wire/state';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scriptsContract } from '#runtimes/scripts/api';
import { ScriptsRuntime, type WorkspaceScriptsConfig } from '#runtimes/scripts/node/runtime';
import type { PtyExitInfo, PtyProcess, PtySpawnSpec, PtySpawner } from '#services/pty/api';
import { createScriptsController } from './controller';

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

const WORKSPACE = '/work/trees/task-1';
const FACTS = { workspaceId: 'ws-1', repositoryPath: '/repos/app', branch: 'feature-x' };

describe('scripts runtime contract', () => {
  let spawner: FakePtySpawner;
  let runtime: ScriptsRuntime;
  let wire: TestWire<typeof scriptsContract>;
  let config: WorkspaceScriptsConfig;
  let hostShellSetup: string | undefined;

  beforeEach(() => {
    spawner = new FakePtySpawner();
    config = {
      scripts: { prepare: 'echo prepare', setup: 'pnpm install', run: 'pnpm dev' },
      shellSetup: undefined,
    };
    hostShellSetup = undefined;
    runtime = new ScriptsRuntime({
      spawner,
      readConfig: async () => config,
      defaultShellSetup: async () => hostShellSetup,
    });
    wire = createTestWire(scriptsContract, createScriptsController(runtime));
  });

  afterEach(() => {
    wire.dispose();
    runtime.dispose();
  });

  async function runsFor(workspacePath: string) {
    const runs = remote(scriptsContract.runs, wire.client.runs);
    const model = runs({ workspacePath });
    try {
      await model.states.current.refresh();
      return snapshot(model.states.current).value ?? {};
    } finally {
      await runs.dispose();
    }
  }

  function start(script: 'prepare' | 'setup' | 'run', overrides: Record<string, unknown> = {}) {
    return wire.client.start({
      workspacePath: WORKSPACE,
      script,
      provenance: 'activation',
      facts: FACTS,
      ...overrides,
    });
  }

  it('runs a script to success: spawn spec, run state, exit code, and tail retention', async () => {
    const started = await start('setup', { provenance: 'manual' });
    expect(started.success && started.data.status).toBe('running');

    const spec = spawner.specs[0]!;
    expect(spec.args?.slice(-1)[0]).toBe('pnpm install');
    expect(spec.cwd).toBe(WORKSPACE);
    expect(spec.env).toMatchObject({
      EMDASH_TASK_ID: 'ws-1',
      EMDASH_TASK_NAME: 'feature-x',
      EMDASH_ROOT_PATH: '/repos/app',
    });
    // CI is never injected: it is whatever the worker's own environment carries.
    expect(spec.env?.CI).toBe(process.env.CI);

    spawner.processes[0]!.emit('installing...\n');
    spawner.processes[0]!.exit({ exitCode: 0, signal: null });

    const settled = await wire.client.wait({ workspacePath: WORKSPACE, script: 'setup' });
    expect(settled.success && settled.data).toMatchObject({
      status: 'succeeded',
      provenance: 'manual',
      exitCode: 0,
      outputTail: 'installing...\n',
    });

    // The tail and the run record survive the exit in the live model.
    const runs = await runsFor(WORKSPACE);
    expect(runs.setup).toMatchObject({ status: 'succeeded', outputTail: 'installing...\n' });
  });

  it('rejects a second start of a running script; different scripts run concurrently', async () => {
    await start('run');
    const again = await start('run');
    expect(!again.success && again.error.type).toBe('run-in-flight');

    const other = await start('setup');
    expect(other.success).toBe(true);
    expect(spawner.processes).toHaveLength(2);
  });

  it('stop settles the run as cancelled regardless of who started it', async () => {
    await start('run');
    const stopped = await wire.client.stop({ workspacePath: WORKSPACE, script: 'run' });
    expect(stopped.success).toBe(true);

    const settled = await wire.client.wait({ workspacePath: WORKSPACE, script: 'run' });
    expect(settled.success && settled.data.status).toBe('cancelled');
  });

  it('a timed-out run settles as timed-out, distinct from failed and cancelled', async () => {
    await start('prepare', { timeoutMs: 20 });
    const settled = await wire.client.wait({ workspacePath: WORKSPACE, script: 'prepare' });
    expect(settled.success && settled.data.status).toBe('timed-out');
    expect(settled.success && settled.data.message).toContain('Timed out');
  });

  it('a non-zero exit settles as failed with the exit code and message', async () => {
    await start('setup');
    spawner.processes[0]!.emit('boom\n');
    spawner.processes[0]!.exit({ exitCode: 3, signal: null });

    const settled = await wire.client.wait({ workspacePath: WORKSPACE, script: 'setup' });
    expect(settled.success && settled.data).toMatchObject({
      status: 'failed',
      exitCode: 3,
      outputTail: 'boom\n',
    });
    expect(settled.success && settled.data.message).toContain('code 3');
  });

  it('a re-run replaces the previous run record', async () => {
    await start('setup');
    spawner.processes[0]!.exit({ exitCode: 1, signal: null });
    await wire.client.wait({ workspacePath: WORKSPACE, script: 'setup' });

    const second = await start('setup', { provenance: 'retry' });
    expect(second.success).toBe(true);
    spawner.processes[1]!.exit({ exitCode: 0, signal: null });
    const settled = await wire.client.wait({ workspacePath: WORKSPACE, script: 'setup' });
    expect(settled.success && settled.data).toMatchObject({
      status: 'succeeded',
      provenance: 'retry',
    });

    const runs = await runsFor(WORKSPACE);
    expect(runs.setup?.status).toBe('succeeded');
  });

  it('start fails cleanly when the script is not configured', async () => {
    config = { scripts: { setup: 'x' } };
    const result = await start('prepare');
    expect(!result.success && result.error.type).toBe('script-not-configured');
  });

  it('stop and wait on a workspace with no runs return not-found', async () => {
    const stopped = await wire.client.stop({ workspacePath: '/nowhere', script: 'run' });
    expect(!stopped.success && stopped.error.type).toBe('not-found');
    const waited = await wire.client.wait({ workspacePath: '/nowhere', script: 'run' });
    expect(!waited.success && waited.error.type).toBe('not-found');
  });

  it('shellSetup: .emdash.json overrides the host default; host default applies otherwise', async () => {
    hostShellSetup = 'source /etc/host-profile';
    await start('setup');
    expect(spawner.specs[0]!.args?.slice(-1)[0]).toBe('source /etc/host-profile\npnpm install');

    config = { ...config, shellSetup: 'source ~/.workspace-profile' };
    await start('prepare');
    expect(spawner.specs[1]!.args?.slice(-1)[0]).toBe('source ~/.workspace-profile\necho prepare');
  });
});
