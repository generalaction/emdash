import { LiveLogSource } from '@emdash/wire/live';
import { describe, expect, it } from 'vitest';
import { FakePtyProcess, TestPressureSignal } from '#services/pty/testing';
import { PtySession } from './pty-session';
import type { PtySpawnSpec } from './types';

function createSpec(): PtySpawnSpec {
  return {
    cols: 80,
    rows: 24,
    cwd: '/tmp',
    env: {},
    invocation: { kind: 'argv', executable: 'sh', argv: [] },
  } as unknown as PtySpawnSpec;
}

describe('PtySession pressure', () => {
  it('pauses and resumes the process as output pressure changes', () => {
    const output = new LiveLogSource();
    const process = new FakePtyProcess(1);
    const signal = new TestPressureSignal();
    const session = new PtySession('session', createSpec(), process, { output });
    const unsubscribe = output.subscribe(() => {}, { pressure: signal });

    signal.set(true);
    expect(process.pauseCalls).toBe(1);
    expect(process.resumeCalls).toBe(0);

    signal.set(false);
    expect(process.pauseCalls).toBe(1);
    expect(process.resumeCalls).toBe(1);

    unsubscribe();
    session.dispose();
  });

  it('resumes the process on exit while output pressure is paused', () => {
    const output = new LiveLogSource();
    const process = new FakePtyProcess(1);
    const signal = new TestPressureSignal();
    const session = new PtySession('session', createSpec(), process, { output });
    const unsubscribe = output.subscribe(() => {}, { pressure: signal });

    signal.set(true);
    expect(process.pauseCalls).toBe(1);

    process.emitExit({ exitCode: 0, signal: null });
    expect(process.resumeCalls).toBe(1);
    expect(session.exited).toBe(true);

    unsubscribe();
    session.dispose();
  });

  it('resumes the process on dispose while output pressure is paused', () => {
    const output = new LiveLogSource();
    const process = new FakePtyProcess(1);
    const signal = new TestPressureSignal();
    const session = new PtySession('session', createSpec(), process, { output });
    const unsubscribe = output.subscribe(() => {}, { pressure: signal });

    signal.set(true);
    expect(process.pauseCalls).toBe(1);

    session.dispose();
    expect(process.resumeCalls).toBe(1);

    unsubscribe();
  });
});
