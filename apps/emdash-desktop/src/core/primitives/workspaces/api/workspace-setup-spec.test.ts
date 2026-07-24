import { describe, expect, it } from 'vitest';
import { compileSetupSpec } from './workspace-setup-spec';

describe('compileSetupSpec', () => {
  it('fetches only the remote branch used to create the workspace branch', () => {
    const spec = compileSetupSpec(
      {
        kind: 'create-branch',
        branchName: 'task-branch',
        fromBranch: {
          type: 'remote',
          branch: 'main',
          remote: { name: 'origin', url: 'https://example.com/repo.git' },
        },
      },
      { host: 'local' },
      { baseRemote: 'origin', pushRemote: 'origin' }
    );

    expect(spec[0]).toEqual({
      kind: 'git-fetch',
      args: {
        remote: 'origin',
        refspec: '+refs/heads/main:refs/remotes/origin/main',
      },
    });
  });
});
