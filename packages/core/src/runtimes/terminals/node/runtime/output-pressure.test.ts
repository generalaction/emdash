import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it } from 'vitest';
import { LOCAL_HOST_REF } from '#primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '#primitives/path/api';
import { FakePtySpawner, TestPressureSignal } from '#services/pty/testing';
import { TerminalsRuntime } from './runtime';

describe('TerminalsRuntime output pressure', () => {
  it('forwards viewer pressure to the PTY and resumes on unsubscribe', async () => {
    const spawner = new FakePtySpawner();
    const scope = createScope({ label: 'test-terminals-output-pressure' });
    const runtime = new TerminalsRuntime({
      spawner,
      scope,
      userEnv: async () => ({ PATH: '/usr/bin' }),
    });

    const key = { workspace: testWorkspace(), id: 'terminal-1' };
    try {
      await runtime.start({ key, spec: { cwd: '/repo', env: {} } });

      const process = spawner.processes[0]!;
      if (!process) throw new Error('PTY process was not spawned');

      const pressure = new TestPressureSignal();
      const unsubscribe = await runtime.outputLog(key).subscribe(() => {}, { pressure });

      pressure.set(true);
      expect(process.pauseCalls).toBe(1);
      expect(process.resumeCalls).toBe(0);

      pressure.set(false);
      expect(process.pauseCalls).toBe(1);
      expect(process.resumeCalls).toBe(1);

      pressure.set(true);
      expect(process.pauseCalls).toBe(2);

      unsubscribe();

      expect(process.pauseCalls).toBe(2);
      expect(process.resumeCalls).toBe(2);
    } finally {
      runtime.dispose();
      await scope.dispose();
    }
  });
});

function testWorkspace(): HostFileRef {
  const parsed = parseAbsolute('/repo', { profile: { style: 'posix' } });
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
