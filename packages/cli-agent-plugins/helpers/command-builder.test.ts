import { describe, expect, it } from 'vitest';
import { CommandBuilder, cmd } from './command-builder';

describe('CommandBuilder', () => {
  it('builds a command with no args', () => {
    const result = new CommandBuilder('/usr/bin/agent').build();
    expect(result).toEqual({ command: '/usr/bin/agent', args: [], env: {} });
  });

  it('appends multiple args', () => {
    const result = cmd('agent').arg('--flag').arg('a', 'b').build();
    expect(result.args).toEqual(['--flag', 'a', 'b']);
  });

  it('argIf includes args when condition is truthy', () => {
    const result = cmd('agent').argIf(true, '--yes').argIf(1, '--one').build();
    expect(result.args).toEqual(['--yes', '--one']);
  });

  it('argIf skips args when condition is falsy', () => {
    const result = cmd('agent')
      .argIf(false, '--no')
      .argIf(0, '--zero')
      .argIf('', '--empty')
      .build();
    expect(result.args).toEqual([]);
  });

  it('sets env vars', () => {
    const result = cmd('agent').env('FOO', 'bar').env('BAZ', 'qux').build();
    expect(result.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('envIf sets env when condition is truthy', () => {
    const result = cmd('agent').envIf(true, 'KEY', 'val').build();
    expect(result.env).toEqual({ KEY: 'val' });
  });

  it('envIf skips env when condition is falsy', () => {
    const result = cmd('agent').envIf(false, 'KEY', 'val').build();
    expect(result.env).toEqual({});
  });

  it('cmd factory returns a CommandBuilder', () => {
    expect(cmd('agent')).toBeInstanceOf(CommandBuilder);
  });

  it('preserves command path', () => {
    const result = cmd('/path/to/binary').build();
    expect(result.command).toBe('/path/to/binary');
  });

  it('supports chaining', () => {
    const builder = cmd('agent');
    expect(builder.arg('a')).toBe(builder);
    expect(builder.argIf(true, 'b')).toBe(builder);
    expect(builder.env('K', 'v')).toBe(builder);
    expect(builder.envIf(true, 'K2', 'v2')).toBe(builder);
  });
});
