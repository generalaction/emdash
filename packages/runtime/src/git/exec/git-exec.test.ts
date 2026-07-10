import { describe, expect, it } from 'vitest';
import { gitEnv } from './git-exec';

describe('gitEnv', () => {
  it('pins git output locale for stable parsing and error classification', () => {
    expect(gitEnv({ LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8' })).toMatchObject({
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('defaults SSH to batch mode without overriding caller configuration', () => {
    expect(gitEnv({ GIT_SSH_COMMAND: undefined }).GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes');
    expect(gitEnv({ GIT_SSH_COMMAND: 'ssh -F custom-config' }).GIT_SSH_COMMAND).toBe(
      'ssh -F custom-config'
    );
  });
});
