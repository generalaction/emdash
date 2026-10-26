import { describe, expect, it } from 'vitest';
import { createNonInteractiveGitExec, nonInteractiveGitEnv } from './git-exec';

describe('nonInteractiveGitEnv', () => {
  it('disables prompts and pins the C locale', () => {
    expect(
      nonInteractiveGitEnv({
        LC_ALL: 'de_DE.UTF-8',
        LANG: 'de_DE.UTF-8',
        GIT_ASKPASS: '/usr/bin/askpass',
        SSH_ASKPASS: '/usr/bin/ssh-askpass',
      })
    ).toMatchObject({
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
    });
  });

  it('defaults SSH to batch mode without overriding caller configuration', () => {
    expect(nonInteractiveGitEnv({}).GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes');
    expect(nonInteractiveGitEnv({ GIT_SSH_COMMAND: 'ssh -F custom-config' }).GIT_SSH_COMMAND).toBe(
      'ssh -F custom-config'
    );
  });
});

describe('createNonInteractiveGitExec', () => {
  it('runs git with the non-interactive environment', () => {
    expect(createNonInteractiveGitExec(process.cwd()).env).toEqual(
      nonInteractiveGitEnv(process.env)
    );
  });
});
