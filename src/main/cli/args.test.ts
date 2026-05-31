import { describe, expect, it } from 'vitest';
import { getBool, getString, parseArgs } from './args';

describe('parseArgs', () => {
  it('parses positionals, value flags, and boolean flags', () => {
    const a = parseArgs(['workspace', 'create', '--project', 'acme', '-b', 'feat/x', '--json']);
    expect(a.positionals).toEqual(['workspace', 'create']);
    expect(getString(a, 'project')).toBe('acme');
    expect(getString(a, 'branch')).toBe('feat/x'); // -b alias
    expect(getBool(a, 'json')).toBe(true);
  });

  it('supports --key=value', () => {
    const a = parseArgs(['--base=origin/main', '--name=My Task']);
    expect(getString(a, 'base')).toBe('origin/main');
    expect(getString(a, 'name')).toBe('My Task');
  });

  it('consumes a value-flag value that begins with "-" (regression)', () => {
    const a = parseArgs(['workspace', 'send', '-m', '-N5 run it']);
    expect(getString(a, 'message')).toBe('-N5 run it');
  });

  it('stops option parsing at "--"', () => {
    const a = parseArgs(['workspace', 'list', '--', '--not-a-flag']);
    expect(getBool(a, 'not-a-flag')).toBe(false);
    expect(a.positionals).toContain('--not-a-flag');
  });

  it('treats a value-flag with no following value as a bare flag', () => {
    const a = parseArgs(['--message']);
    expect(getString(a, 'message')).toBeUndefined();
  });
});
