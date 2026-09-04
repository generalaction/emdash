import { describe, expect, it } from 'vitest';
import type { ChatExecute } from '@/model';
import { executeHeaderTitle, executeShowsBody } from './execute-layout';

function item(overrides: Partial<ChatExecute> = {}): ChatExecute {
  return {
    kind: 'execute',
    id: 'x',
    command: 'git status',
    status: 'done',
    startedAt: 0,
    ...overrides,
  };
}

describe('executeShowsBody', () => {
  it('hides the body in every state unless the row is expanded', () => {
    expect(executeShowsBody(item({ status: 'done' }), false)).toBe(false);
    expect(executeShowsBody(item({ status: 'error' }), false)).toBe(false);
    expect(executeShowsBody(item({ status: 'running' }), false)).toBe(false);
  });

  it('shows the body whenever the row is expanded', () => {
    expect(executeShowsBody(item({ status: 'done' }), true)).toBe(true);
    expect(executeShowsBody(item({ status: 'running' }), true)).toBe(true);
  });
});

describe('executeHeaderTitle', () => {
  it('prefers the provider description', () => {
    expect(executeHeaderTitle(item({ inputSummary: 'Show working tree status' }))).toEqual({
      text: 'Show working tree status',
      mono: false,
    });
  });

  it('falls back to the first command line, rendered as code', () => {
    expect(executeHeaderTitle(item({ command: 'git status\ngit log' }))).toEqual({
      text: 'git status',
      mono: true,
    });
  });

  it('ignores a blank description', () => {
    expect(executeHeaderTitle(item({ inputSummary: '   ' }))).toEqual({
      text: 'git status',
      mono: true,
    });
  });

  it('uses the generic label when the command has not arrived yet', () => {
    expect(executeHeaderTitle(item({ command: '' }))).toEqual({ text: 'Execute', mono: false });
  });
});
