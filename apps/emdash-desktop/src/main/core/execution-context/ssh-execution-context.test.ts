import { describe, expect, it } from 'vitest';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { buildSshCommand } from './ssh-execution-context';

describe('buildSshCommand', () => {
  it('uses the shared remote shell command builder for fallback SSH exec commands', () => {
    const command = buildSshCommand('/workspace/project', 'which', ['claude']);

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && which '\\''claude'\\'''"
    );
  });

  it('uses the remote shell profile and cwd when building SSH exec commands', () => {
    const profile: RemoteShellProfile = {
      shell: '/bin/zsh',
      env: {
        PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
      },
    };

    const command = buildSshCommand('/workspace/project', 'which', ['claude'], profile);

    expect(command).toBe(
      "'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd '\\''/workspace/project'\\'' && which '\\''claude'\\'''"
    );
  });

  it('disables interactive Git credential prompts for SSH exec commands', () => {
    const command = buildSshCommand('/workspace/project', 'git', ['fetch', 'origin']);

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && GIT_ASKPASS='\\'''\\'' GIT_TERMINAL_PROMPT='\\''0'\\'' GCM_INTERACTIVE='\\''never'\\'' SSH_ASKPASS='\\'''\\'' git '\\''fetch'\\'' '\\''origin'\\'''"
    );
  });
});
