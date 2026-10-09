import { describe, expect, it } from 'vitest';
import { isTaskNamingCommand, withTaskNamingCommands } from './task-naming-commands';

describe('task naming commands', () => {
  it('offers the Emdash command and alias alongside provider commands', () => {
    expect(withTaskNamingCommands([{ name: 'review', description: 'Review changes' }])).toEqual([
      expect.objectContaining({ name: 'rename-task', behavior: 'insert' }),
      expect.objectContaining({ name: 'rename', behavior: 'insert' }),
      { id: 'review', name: 'review', description: 'Review changes', behavior: 'insert' },
    ]);
  });

  it.each(['rename', '/rename', 'RENAME', '/Rename'])(
    'preserves the native %s command and omits the local alias',
    (name) => {
      const native = { name, description: 'Rename the provider session' };
      expect(withTaskNamingCommands([native])).toEqual([
        expect.objectContaining({ name: 'rename-task' }),
        { id: name, ...native, behavior: 'insert' },
      ]);
      expect(isTaskNamingCommand('/rename', [native])).toBe(false);
      expect(isTaskNamingCommand('/rename-task', [native])).toBe(true);
    }
  );

  it.each(['rename-task', '/rename-task', 'RENAME-TASK', '/Rename-Task'])(
    'deduplicates native %s in favor of the Emdash command',
    (name) => {
      expect(withTaskNamingCommands([{ name, description: 'Native command' }])).toEqual([
        expect.objectContaining({
          name: 'rename-task',
          description: 'Name this task with the current conversation AI (Emdash).',
        }),
        expect.objectContaining({ name: 'rename' }),
      ]);
    }
  );

  it.each(['/rename-task', '/rename', '  /rename-task  ', '\t/rename\t'])(
    'intercepts the bare command %j',
    (text) => {
      expect(isTaskNamingCommand(text, [])).toBe(true);
    }
  );

  it.each([
    '/rename custom name',
    '/rename-task custom name',
    '/rename/path',
    '/rename-task/path',
    '/rename.md',
    'Discuss /rename',
    '/rename\nmore work',
    '/rename-task\r\nmore work',
    '\n/rename\n',
    '/rename-task\n',
    '/RENAME',
    '',
  ])('leaves ordinary prompts and provider arguments unchanged: %j', (text) => {
    expect(isTaskNamingCommand(text, [])).toBe(false);
  });
});
