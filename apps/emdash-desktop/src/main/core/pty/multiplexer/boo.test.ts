import { describe, expect, it, vi } from 'vitest';
import { booBackend } from './boo';

describe('booBackend', () => {
  it('has id "boo"', () => {
    expect(booBackend.id).toBe('boo');
  });

  it('makeSessionName matches the emdash-<base64url> scheme', () => {
    expect(booBackend.makeSessionName('p:t:c')).toBe(
      `emdash-${Buffer.from('p:t:c', 'utf8').toString('base64url')}`
    );
  });

  it('buildAttachShellLine creates-if-missing then execs attach', () => {
    const line = booBackend.buildAttachShellLine('agent-session', 'exec /bin/zsh -il');
    expect(line).toMatch(/^\/bin\/sh -c /);
    expect(line).toContain('boo new \\"agent-session\\"');
    expect(line).toContain('exec boo attach \\"agent-session\\"');
    // Lock in the spike-confirmed idiom: -d backgrounds the session and 2>/dev/null
    // silences the "already exists" failure so the ;-chained attach still runs.
    expect(line).toContain('-d --');
    expect(line).toContain('2>/dev/null');
  });

  it('killSession runs `boo kill <name>` and swallows errors', async () => {
    const ctx = { exec: vi.fn().mockRejectedValue(new Error('gone')) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await booBackend.killSession(ctx as any, 'agent-session');
    expect(ctx.exec).toHaveBeenCalledWith('boo', ['kill', 'agent-session']);
  });
});
