import { describe, expect, it, vi } from 'vitest';
import { PtyRegistry } from './pty-registry';
import type { PtyExitInfo, PtyProcess, PtySpawnSpec, PtySpawner } from './types';

class FakePtyProcess implements PtyProcess {
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(info: PtyExitInfo): void {
    for (const handler of this.exitHandlers) handler(info);
  }
}

class FakePtySpawner implements PtySpawner {
  readonly specs: PtySpawnSpec[] = [];
  readonly processes: FakePtyProcess[] = [];

  spawn(spec: PtySpawnSpec): PtyProcess {
    this.specs.push(spec);
    const process = new FakePtyProcess();
    this.processes.push(process);
    return process;
  }
}

const spec: PtySpawnSpec = {
  command: 'claude',
  args: ['auth', 'login'],
  cwd: '/tmp',
  env: { PATH: '/bin' },
  cols: 120,
  rows: 30,
};

describe('PtyRegistry', () => {
  it('spawns a session and streams output into a LiveLog', async () => {
    const spawner = new FakePtySpawner();
    const registry = new PtyRegistry(spawner);

    const session = await registry.create('auth:claude', spec);
    spawner.processes[0]!.emitData('hello');
    spawner.processes[0]!.emitData(' world');

    expect(spawner.specs).toEqual([spec]);
    expect(registry.get('auth:claude')).toBe(session);
    expect(registry.getLog('auth:claude')?.snapshot().data.text).toBe('hello world');
  });

  it('forwards input, resize, and kill to the process', async () => {
    const spawner = new FakePtySpawner();
    const registry = new PtyRegistry(spawner);

    await registry.create('auth:claude', spec);
    registry.write('auth:claude', 'abc');
    registry.resize('auth:claude', 80, 24);
    registry.kill('auth:claude');

    expect(spawner.processes[0]!.write).toHaveBeenCalledWith('abc');
    expect(spawner.processes[0]!.resize).toHaveBeenCalledWith(80, 24);
    expect(spawner.processes[0]!.kill).toHaveBeenCalled();
  });

  it('tracks exit status and notifies registry changes', async () => {
    const spawner = new FakePtySpawner();
    const onSessionChanged = vi.fn();
    const registry = new PtyRegistry(spawner, { onSessionChanged });

    const session = await registry.create('auth:claude', spec);
    spawner.processes[0]!.emitExit({ exitCode: 0, signal: null });

    expect(session.exitStatus).toEqual({ exitCode: 0, signal: null });
    expect(onSessionChanged).toHaveBeenLastCalledWith('auth:claude', session);
  });

  it('replaces an existing session by default', async () => {
    const spawner = new FakePtySpawner();
    const registry = new PtyRegistry(spawner);

    await registry.create('auth:claude', spec);
    await registry.create('auth:claude', { ...spec, args: [] });

    expect(spawner.processes[0]!.kill).toHaveBeenCalled();
    expect(spawner.processes).toHaveLength(2);
    expect(registry.get('auth:claude')?.spec.args).toEqual([]);
  });
});
