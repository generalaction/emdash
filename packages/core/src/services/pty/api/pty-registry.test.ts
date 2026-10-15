import { describe, expect, it, vi } from 'vitest';
import { FakePtySpawner } from '#services/pty/testing';
import { PtyRegistry } from './pty-registry';
import type { PtySpawnSpec } from './types';

const spec: PtySpawnSpec = {
  invocation: { kind: 'argv', executable: 'claude', argv: ['auth', 'login'] },
  cwd: '/tmp',
  env: { PATH: '/bin' },
  cols: 120,
  rows: 30,
};

describe('PtyRegistry', () => {
  it('spawns a session and streams output into a LiveLogSource', async () => {
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

    expect(spawner.processes[0]!.writes).toEqual(['abc']);
    expect(spawner.processes[0]!.resizes).toEqual([{ cols: 80, rows: 24 }]);
    expect(spawner.processes[0]!.killCount).toBeGreaterThan(0);
  });

  it('rejects input once the retained session has exited or been disposed', async () => {
    const spawner = new FakePtySpawner();
    const registry = new PtyRegistry(spawner);

    await registry.create('review', spec);
    expect(registry.write('review', 'typed')).toBe(true);
    spawner.processes[0]!.emitExit({ exitCode: 0, signal: null });

    expect(registry.get('review')?.exited).toBe(true);
    expect(registry.getLog('review')).not.toBeNull();
    expect(registry.write('review', 'lost paste')).toBe(false);
    registry.dispose('review');
    expect(registry.write('review', 'after dispose')).toBe(false);
    expect(spawner.processes[0]!.writes).toEqual(['typed']);
  });

  it('surfaces a failing process write instead of reporting it accepted', async () => {
    const spawner = new FakePtySpawner();
    const registry = new PtyRegistry(spawner);

    await registry.create('review', spec);
    vi.spyOn(spawner.processes[0]!, 'write').mockImplementation(() => {
      throw new Error('EIO');
    });

    expect(() => registry.write('review', 'paste')).toThrow('EIO');
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
    await registry.create('auth:claude', {
      ...spec,
      invocation: { kind: 'argv', executable: 'claude', argv: [] },
    });

    expect(spawner.processes[0]!.killCount).toBeGreaterThan(0);
    expect(spawner.processes).toHaveLength(2);
    expect(registry.get('auth:claude')?.spec.invocation).toEqual({
      kind: 'argv',
      executable: 'claude',
      argv: [],
    });
  });
});
