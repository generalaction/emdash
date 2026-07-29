import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import { describe, expect, it } from 'vitest';
import { compileProvisioningIntent } from './intent-compiler';

describe('compileProvisioningIntent', () => {
  it('compiles directory provisioning to a direct provision input', () => {
    const workspace = absolute('/srv/fixed');

    expect(
      compileProvisioningIntent({
        workspace: { kind: 'directory', path: workspace },
        generatedName: 'automation-1',
      })
    ).toEqual({
      provisionInput: { workspace },
      branchName: null,
    });
  });

  it('compiles worktree provisioning to a provision input with lifecycle setup', () => {
    const repository = absolute('/srv/repository');
    const compiled = compileProvisioningIntent({
      workspace: {
        kind: 'worktree',
        repository,
        worktreePoolPath: absolute('/srv/worktrees').path,
        baseRemote: 'origin',
        preservePatterns: ['.env*'],
        git: {
          kind: 'create-branch',
          fromBranch: { type: 'local', branch: 'main' },
          pushRemote: 'origin',
        },
      },
      generatedName: 'automation-2',
    });

    expect(compiled.branchName).toBe('automation-2');
    expect(compiled.provisionInput.workspace).toEqual(absolute('/srv/worktrees/automation-2'));
    const lifecycle = compiled.provisionInput.lifecycle;
    expect(lifecycle).toBeDefined();
    if (!lifecycle) throw new Error('expected lifecycle');
    expect(lifecycle).toMatchObject({
      ref: {
        kind: 'worktree',
        repoPath: '/srv/repository',
        path: '/srv/worktrees/automation-2',
        branchName: 'automation-2',
      },
      context: {
        repoPath: '/srv/repository',
        preservePatterns: ['.env*'],
        worktreePoolPath: '/srv/worktrees',
      },
    });
    const setupPlan = lifecycle.setupPlan;
    expect(setupPlan).toBeDefined();
    if (!setupPlan) throw new Error('expected setup plan');
    expect(setupPlan.steps.map((step) => step.step.kind)).toEqual([
      'create-local-branch',
      'set-branch-base',
      'add-worktree',
      'copy-preserved-files',
      'push-branch',
    ]);
  });
});

function absolute(input: string) {
  const parsed = parseAbsolute(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
