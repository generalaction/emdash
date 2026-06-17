import { describe, expect, it, vi } from 'vitest';
import { killSessionById } from './cleanup';

function fakeCtx() {
  return { exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }) };
}

describe('killSessionById', () => {
  it('kills both tmux and boo names for an agent/conversation id', async () => {
    const ctx = fakeCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await killSessionById({ hostCtx: ctx as any, kind: 'agent', sessionId: 'p:t:c' });
    const calls = ctx.exec.mock.calls.map((c) => c[0]);
    expect(calls).toContain('tmux');
    expect(calls).toContain('boo');
  });

  it('kills only tmux for a terminal id', async () => {
    const ctx = fakeCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await killSessionById({ hostCtx: ctx as any, kind: 'terminal', sessionId: 'p:t:term' });
    const cmds = ctx.exec.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual(['tmux']);
  });
});
