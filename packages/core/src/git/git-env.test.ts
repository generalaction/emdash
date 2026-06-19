import { describe, expect, it } from 'vitest';
import { gitEnv } from './git-env';

describe('gitEnv', () => {
  it('pins git output locale for stable parsing and error classification', () => {
    expect(gitEnv({ LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8' })).toMatchObject({
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
    });
  });
});
