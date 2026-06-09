import { describe, expect, it } from 'vitest';
import { buildEmdashHookCommand, filterUserHooks, EMDASH_MARKER } from './hooks';

describe('buildEmdashHookCommand', () => {
  it('produces a curl POST command', () => {
    const cmd = buildEmdashHookCommand({ platform: 'linux', eventType: 'notification' });
    expect(cmd).toContain('curl');
    expect(cmd).toContain('-X POST');
  });

  it('interpolates the event type', () => {
    const cmd = buildEmdashHookCommand({ platform: 'darwin', eventType: 'stop' });
    expect(cmd).toContain('X-Emdash-Event-Type: stop');
  });

  it('references hook env vars', () => {
    const cmd = buildEmdashHookCommand({ platform: 'linux', eventType: 'start' });
    expect(cmd).toContain('$EMDASH_HOOK_TOKEN');
    expect(cmd).toContain('$EMDASH_PTY_ID');
    expect(cmd).toContain('$EMDASH_HOOK_PORT');
  });

  it('produces different commands for different event types', () => {
    const a = buildEmdashHookCommand({ platform: 'linux', eventType: 'notification' });
    const b = buildEmdashHookCommand({ platform: 'linux', eventType: 'stop' });
    expect(a).not.toBe(b);
  });
});

describe('filterUserHooks', () => {
  it('removes entries that contain the emdash marker', () => {
    const entries = [
      { command: `curl http://127.0.0.1:$${EMDASH_MARKER}/hook` },
      { command: 'echo user-hook' },
      { command: `some-cmd --port $${EMDASH_MARKER}` },
    ];
    const result = filterUserHooks(entries, (e) => JSON.stringify(e));
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('echo user-hook');
  });

  it('keeps all entries when none contain the marker', () => {
    const entries = ['echo a', 'echo b', 'my-script'];
    expect(filterUserHooks(entries)).toEqual(entries);
  });

  it('returns empty array when all entries are emdash-managed', () => {
    const entries = [`${EMDASH_MARKER}_cmd`, `prefix_${EMDASH_MARKER}`];
    expect(filterUserHooks(entries)).toEqual([]);
  });

  it('uses JSON.stringify as default stringifier', () => {
    const entries = [{ x: EMDASH_MARKER }, { x: 'user' }];
    const result = filterUserHooks(entries);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe('user');
  });
});
